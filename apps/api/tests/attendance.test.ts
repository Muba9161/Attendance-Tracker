import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app";
import {
  Employee,
  IEmployee,
  User,
  IUser,
  AttendanceRecord,
  AttendancePolicy,
  QrDisplay,
  QrToken,
  QrChallenge,
  AuditEvent,
} from "../src/models";
import { ApiErrorCode, AttendanceStatus, UserRole, WorkType, getDateKey } from "@vorldx/shared";
import { env } from "../src/config/env";
import * as qrService from "../src/services/qr.service";
import crypto from "crypto";

describe("Attendance Scanning & Punctuality Engine (POST /attendance/scan)", () => {
  let employeeUser: IUser;
  let employeeDoc: IEmployee;
  let employeeToken: string;
  let pairedDisplay: { displayId: string; credential: string; terminalId: string };

  beforeEach(async () => {
    await AttendanceRecord.deleteMany({});
    await QrChallenge.deleteMany({});
    await QrToken.deleteMany({});
    await QrDisplay.deleteMany({});
    await AttendancePolicy.deleteMany({});
    await Employee.deleteMany({});
    await User.deleteMany({});
    await AuditEvent.deleteMany({});

    // 1. Create Default Attendance Policy with Daytime and Overnight shifts
    const policyDoc = await AttendancePolicy.create({
      name: "Standard Corporate Policy",
      version: 1,
      timezone: "Asia/Kolkata",
      defaultGraceMinutes: 15,
      minFullDayHours: 8,
      minHalfDayHours: 4,
      monthlyWfhQuota: 4,
      isDefault: true,
      workdays: [1, 2, 3, 4, 5],
      shifts: [
        {
          name: "General Day Shift",
          startTime: "09:00",
          endTime: "18:00",
          graceMinutes: 15,
          checkInWindowStartMinutes: 60,
          checkInWindowEndMinutes: 180,
          checkOutWindowStartMinutes: 60,
          checkOutWindowEndMinutes: 180,
          isOvernight: false,
          isActive: true,
        },
        {
          name: "Overnight Night Shift",
          startTime: "21:00",
          endTime: "06:00",
          graceMinutes: 15,
          checkInWindowStartMinutes: 60,
          checkInWindowEndMinutes: 180,
          checkOutWindowStartMinutes: 60,
          checkOutWindowEndMinutes: 180,
          isOvernight: true,
          isActive: true,
        },
      ],
    });

    // 2. Create Active Employee & Linked User
    employeeDoc = await Employee.create({
      employeeId: "EMP-1001",
      name: "Rohan Verma",
      email: "rohan.verma@vorldx.demo",
      department: "Engineering",
      designation: "Software Engineer",
      workType: WorkType.FULL_TIME,
      shiftId: policyDoc.shifts[0]._id,
      joiningDate: "2026-01-15",
      isActive: true,
    });

    employeeUser = await User.create({
      employeeId: employeeDoc.employeeId,
      email: employeeDoc.email,
      passwordHash: "dummyHash",
      role: UserRole.EMPLOYEE,
      status: "ACTIVE",
    });

    employeeDoc.userId = employeeUser._id;
    await employeeDoc.save();

    employeeToken = jwt.sign(
      {
        userId: employeeUser._id.toString(),
        employeeId: employeeUser.employeeId,
        email: employeeUser.email,
        role: employeeUser.role,
      },
      env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 3. Register & Pair an Office Display Terminal
    const reg = await qrService.registerDisplay({
      name: "Main Entrance Screen",
      location: "Tower A Ground Floor",
    });
    pairedDisplay = await qrService.pairDisplay(reg.pairingCode!);
  });

  describe("On-Time vs Late Check-In", () => {
    it("records on-time check-in (status: PRESENT, isLate: false) when within grace period", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      // 09:10 AM IST (Shift is 09:00 with 15m grace -> On-Time!)
      // 09:10 AM IST in UTC is 03:40 AM UTC
      const punchTime = new Date("2026-10-20T03:40:00.000Z");

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: challenge.token,
          simulatedNow: punchTime.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.punchType).toBe("CHECK_IN");
      expect(res.body.status).toBe(AttendanceStatus.PRESENT);
      expect(res.body.isLate).toBe(false);
      expect(res.body.lateMinutes).toBe(0);
      expect(res.body.record.dateKey).toBe("2026-10-20");
      expect(res.body.record.checkInTime).toBeDefined();
      expect(res.body.record.checkOutTime).toBeNull();
    });

    it("records late check-in (status: LATE, isLate: true, lateMinutes) when after grace period", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      // 09:45 AM IST (Shift is 09:00 with 15m grace -> Late by 45 minutes!)
      // 09:45 AM IST in UTC is 04:15 AM UTC
      const punchTime = new Date("2026-10-20T04:15:00.000Z");

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: challenge.token,
          simulatedNow: punchTime.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.punchType).toBe("CHECK_IN");
      expect(res.body.status).toBe(AttendanceStatus.LATE);
      expect(res.body.isLate).toBe(true);
      expect(res.body.lateMinutes).toBe(45);
      expect(res.body.record.status).toBe(AttendanceStatus.LATE);
    });
  });

  describe("Check-Out Transitions & State Machine Prohibitions", () => {
    it.each([
      { label: "half-day", checkoutTime: "2026-10-20T07:30:00.000Z", durationMinutes: 240, status: AttendanceStatus.HALF_DAY },
      { label: "full-day", checkoutTime: "2026-10-20T11:30:00.000Z", durationMinutes: 480, status: AttendanceStatus.CHECKED_OUT },
    ])("applies the exact $label duration threshold", async ({ checkoutTime, durationMinutes, status }) => {
      const checkInQr = await qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential);
      const checkIn = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: checkInQr.token, simulatedNow: "2026-10-20T03:30:00.000Z" });
      expect(checkIn.status).toBe(200);

      const checkoutQr = await qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential);
      const checkout = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: checkoutQr.token, simulatedNow: checkoutTime, earlyCheckoutReason: "Threshold boundary test" });

      expect(checkout.status).toBe(200);
      expect(checkout.body.durationMinutes).toBe(durationMinutes);
      expect(checkout.body.status).toBe(status);
      const stored = await AttendanceRecord.findById(checkIn.body.record._id);
      expect(stored?.durationMinutes).toBe(durationMinutes);
      expect(stored?.status).toBe(status);
    });

    it("successfully checks out with calculated work duration when checked in", async () => {
      // 1. Check in at 09:00 AM IST (03:30 AM UTC)
      const token1 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const checkInTime = new Date("2026-10-20T03:30:00.000Z");

      await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: token1.token,
          simulatedNow: checkInTime.toISOString(),
        });

      // 2. Check out at 06:00 PM IST (12:30 PM UTC) -> 9 hours = 540 minutes
      const token2 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const checkOutTime = new Date("2026-10-20T12:30:00.000Z");

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: token2.token,
          simulatedNow: checkOutTime.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.punchType).toBe("CHECK_OUT");
      expect(res.body.status).toBe(AttendanceStatus.CHECKED_OUT);
      expect(res.body.durationMinutes).toBe(540);
      expect(res.body.record.checkOutTime).toBeDefined();

      // Verify in DB
      const dbRecord = await AttendanceRecord.findOne({
        employee: employeeDoc._id,
        dateKey: "2026-10-20",
      });
      expect(dbRecord?.status).toBe(AttendanceStatus.CHECKED_OUT);
      expect(dbRecord?.durationMinutes).toBe(540);
    });

    it("requires and persists a non-empty reason for an early checkout without consuming the QR first", async () => {
      const inQr = await qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential);
      await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: inQr.token, simulatedNow: "2026-10-20T03:30:00.000Z" });
      const outQr = await qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential);
      const earlyTime = "2026-10-20T11:30:00.000Z"; // 5:00 PM IST, before the 6:00 PM shift end
      const prompt = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: outQr.token, simulatedNow: earlyTime });
      expect(prompt.status).toBe(428);
      expect(prompt.body.code).toBe(ApiErrorCode.ERR_EARLY_CHECKOUT_REASON_REQUIRED);
      expect(await QrChallenge.exists({ employee: employeeDoc._id, qrNonce: outQr.token })).toBeFalsy();
      expect(await AttendanceRecord.findOne({ employee: employeeDoc._id, dateKey: "2026-10-20", checkOutTime: null })).toBeTruthy();

      const emptyReason = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: outQr.token, simulatedNow: earlyTime, earlyCheckoutReason: "   " });
      expect(emptyReason.status).toBe(428);
      expect(await QrChallenge.exists({ employee: employeeDoc._id, qrNonce: outQr.token })).toBeFalsy();

      const completed = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: outQr.token, simulatedNow: earlyTime, earlyCheckoutReason: "Medical appointment" });
      expect(completed.status).toBe(200);
      expect(completed.body.record.isEarlyCheckout).toBe(true);
      expect(completed.body.record.earlyCheckoutReason).toBe("Medical appointment");
      expect(new Date(completed.body.record.checkOutTime).toISOString()).toBe(earlyTime);
    });

    it("blocks attendance safely when the employee has no assigned shift", async () => {
      employeeDoc.shiftId = undefined;
      await employeeDoc.save();
      const inQr = await qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential);
      const checkout = await request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: inQr.token, simulatedNow: "2026-10-20T03:30:00.000Z" });
      expect(checkout.status).toBe(409);
      expect(checkout.body.code).toBe(ApiErrorCode.ERR_SHIFT_NOT_ASSIGNED);
      const record = await AttendanceRecord.findOne({ employee: employeeDoc._id, dateKey: "2026-10-20" });
      expect(record).toBeNull();
    });

    it("rejects duplicate check-in with 409 ERR_ALREADY_CHECKED_IN", async () => {
      // 1. Check in
      const token1 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: token1.token });

      // 2. Attempt check-in again with action=CHECK_IN
      const token2 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: token2.token, action: "CHECK_IN" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiErrorCode.ERR_ALREADY_CHECKED_IN);
    });

    it("rejects punch when already completed checkout for the day", async () => {
      // 1. Check in
      const t1 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: t1.token, simulatedNow: "2026-10-20T03:30:00.000Z" });

      // 2. Check out
      const t2 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: t2.token, simulatedNow: "2026-10-20T12:30:00.000Z" });

      // 3. Scan a third time after checkout
      const t3 = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: t3.token, simulatedNow: "2026-10-20T12:31:00.000Z" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ApiErrorCode.ERR_ALREADY_CHECKED_IN);
      expect(res.body.message).toContain("already checked out");
    });

    it("rejects check-out without check-in with 400 ERR_NO_ACTIVE_CHECKIN", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: challenge.token,
          action: "CHECK_OUT",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_NO_ACTIVE_CHECKIN);
    });

    it("rejects inactive employees with 403 ERR_EMPLOYEE_INACTIVE", async () => {
      employeeDoc.isActive = false;
      await employeeDoc.save();

      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ApiErrorCode.ERR_EMPLOYEE_INACTIVE);
    });
  });

  describe("QR Security Validations & Replay Defense", () => {
    it("consumes a successful QR once, rotates immediately, and lets another employee use the successor", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      await QrToken.updateOne(
        { token: challenge.token },
        { $set: { issuedAt: new Date(Date.now() - 10_000) } }
      );
      const firstScan = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token, simulatedNow: "2026-10-20T03:40:00.000Z" });

      expect(firstScan.status).toBe(200);
      expect(await AttendanceRecord.countDocuments({ employee: employeeDoc._id })).toBe(1);
      const consumed = await QrToken.findOne({ token: challenge.token });
      expect(consumed?.consumedAt).toBeInstanceOf(Date);
      expect(consumed?.reservationId).toBeNull();

      const successor = await QrToken.findOne({ displayId: pairedDisplay.displayId })
        .sort({ issuedAt: -1 });
      expect(successor?.token).toBeTruthy();
      expect(successor?.token).not.toBe(challenge.token);

      const nextEmployee = await Employee.create({
        employeeId: "EMP-1002",
        name: "Second Employee",
        email: "second.employee@vorldx.demo",
        department: "Engineering",
        designation: "Engineer",
        workType: WorkType.FULL_TIME,
        shiftId: employeeDoc.shiftId,
        joiningDate: "2026-01-15",
        isActive: true,
      });
      const nextUser = await User.create({
        employeeId: nextEmployee.employeeId,
        email: nextEmployee.email,
        passwordHash: "dummyHash",
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
      });
      nextEmployee.userId = nextUser._id;
      await nextEmployee.save();
      const nextToken = jwt.sign({
        userId: nextUser._id.toString(),
        employeeId: nextUser.employeeId,
        email: nextUser.email,
        role: nextUser.role,
      }, env.JWT_SECRET, { expiresIn: "1h" });

      const secondScan = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${nextToken}`)
        .send({ token: successor!.token, simulatedNow: "2026-10-20T03:45:00.000Z" });
      expect(secondScan.status).toBe(200);

      const replay = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${nextToken}`)
        .send({ token: challenge.token });
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe(ApiErrorCode.ERR_QR_REPLAY_DETECTED);
    });

    it("does not consume or rotate the QR when attendance is rejected", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const failed = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token, action: "CHECK_OUT" });

      expect(failed.status).toBe(400);
      expect(await QrToken.countDocuments({ displayId: pairedDisplay.displayId })).toBe(1);
      const stored = await QrToken.findOne({ token: challenge.token });
      expect(stored?.consumedAt).toBeNull();
      expect(stored?.reservationId).toBeNull();
    });

    it("allows only one of two employees to consume the same QR concurrently", async () => {
      const secondEmployee = await Employee.create({
        employeeId: "EMP-1002",
        name: "Concurrent Employee",
        email: "concurrent.employee@vorldx.demo",
        department: "Engineering",
        designation: "Engineer",
        workType: WorkType.FULL_TIME,
        shiftId: employeeDoc.shiftId,
        joiningDate: "2026-01-15",
        isActive: true,
      });
      const secondUser = await User.create({
        employeeId: secondEmployee.employeeId,
        email: secondEmployee.email,
        passwordHash: "dummyHash",
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
      });
      secondEmployee.userId = secondUser._id;
      await secondEmployee.save();
      const secondToken = jwt.sign({
        userId: secondUser._id.toString(),
        employeeId: secondUser.employeeId,
        email: secondUser.email,
        role: secondUser.role,
      }, env.JWT_SECRET, { expiresIn: "1h" });
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      const results = await Promise.all([
        request(app).post("/attendance/scan").set("Authorization", `Bearer ${employeeToken}`)
          .send({ token: challenge.token, simulatedNow: "2026-10-20T03:40:00.000Z" }),
        request(app).post("/attendance/scan").set("Authorization", `Bearer ${secondToken}`)
          .send({ token: challenge.token, simulatedNow: "2026-10-20T03:40:00.000Z" }),
      ]);

      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      expect(results.filter((result) => result.status === 409)).toHaveLength(1);
      expect(await AttendanceRecord.countDocuments({})).toBe(1);
    });

    it("also records and globally consumes a valid legacy signed QR", async () => {
      const display = await QrDisplay.findOne({ terminalId: pairedDisplay.terminalId });
      const ts = Math.floor(Date.now() / 1000);
      const exp = ts + 45;
      const nonce = crypto.randomBytes(12).toString("hex");
      const signaturePayload = `1:${pairedDisplay.terminalId}:${ts}:${exp}:${nonce}`;
      const sig = crypto.createHmac("sha256", display!.displayCredentialHash!)
        .update(signaturePayload).digest("hex");
      const signedPayload = JSON.stringify({ v: 1, tid: pairedDisplay.terminalId, ts, exp, n: nonce, sig });

      const firstScan = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: signedPayload, simulatedNow: "2026-10-20T03:40:00.000Z" });
      expect(firstScan.status).toBe(200);
      expect((await QrToken.findOne({ token: signedPayload }))?.consumedAt).toBeInstanceOf(Date);

      const replay = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: signedPayload });
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe(ApiErrorCode.ERR_QR_REPLAY_DETECTED);
    });

    it("rejects expired QR token with 400 ERR_QR_EXPIRED", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      // Expire token in database
      await QrToken.updateOne(
        { token: challenge.token },
        { $set: { expiresAt: new Date(Date.now() - 5000) } }
      );

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_QR_EXPIRED);
    });

    it("rejects forged or invalid QR token with 400 ERR_INVALID_QR_TOKEN", async () => {
      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: "qrt_forged_fake_token_value_xyz" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_INVALID_QR_TOKEN);
    });

    it("rejects tokens issued by revoked display with ERR_DISPLAY_REVOKED / ERR_QR_REVOKED", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      // HR revokes the display
      await qrService.revokeDisplay(pairedDisplay.displayId, "Compromised kiosk");

      const res = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token });

      expect(res.status).toBe(400);
      expect(
        res.body.code === ApiErrorCode.ERR_DISPLAY_REVOKED ||
          res.body.code === ApiErrorCode.ERR_QR_REVOKED
      ).toBe(true);
    });

    it("rejects replayed token (same employee scanning same token twice) with 409 ERR_QR_REPLAY_DETECTED", async () => {
      const challenge = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );

      // Scan #1
      const res1 = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token, simulatedNow: "2026-10-20T12:00:00.000Z" });
      expect(res1.status).toBe(200);

      // Scan #2 with the exact same token by the SAME employee
      const res2 = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: challenge.token });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe(ApiErrorCode.ERR_QR_REPLAY_DETECTED);
    });
  });

  describe("High Concurrency: 20 Parallel Scans", () => {
    it("safely handles 20 parallel scans for the same employee, creating exactly ONE record", async () => {
      // Generate 20 distinct valid tokens so replay defense is not the only gate
      const tokens = await Promise.all(
        Array.from({ length: 20 }, () =>
          qrService.requestRotatingChallenge(pairedDisplay.displayId, pairedDisplay.credential)
        )
      );

      const checkInTime = new Date("2026-10-20T03:30:00.000Z");

      // Fire 20 requests simultaneously
      const results = await Promise.all(
        tokens.map((t) =>
          request(app)
            .post("/attendance/scan")
            .set("Authorization", `Bearer ${employeeToken}`)
            .send({
              token: t.token,
              simulatedNow: checkInTime.toISOString(),
            })
        )
      );

      // At least one request succeeded with 200 CHECK_IN
      const successCount = results.filter((r) => r.status === 200).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // The other concurrent requests received 409 (ERR_ALREADY_CHECKED_IN or ERR_QR_REPLAY_DETECTED)
      const conflictCount = results.filter((r) => r.status === 409).length;
      expect(successCount + conflictCount).toBe(20);

      // CRITICAL GUARANTEE: Exactly 1 record exists in the database
      const records = await AttendanceRecord.find({
        employee: employeeDoc._id,
        dateKey: "2026-10-20",
      });
      expect(records.length).toBe(1);
    });
  });

  describe("Midnight Boundary & Overnight Shift Handling", () => {
    it("accurately checks in on Day D and checks out across midnight on Day D+1 without duplicate record", async () => {
      const policy = await AttendancePolicy.findOne({ isDefault: true });
      employeeDoc.shiftId = policy!.shifts[1]._id;
      await employeeDoc.save();
      // 1. Employee assigned to Overnight Shift (21:00 to 06:00 next day)
      // Check in at 21:30 IST on 2026-10-20 (16:00 UTC on 2026-10-20)
      const tokenIn = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const inTimeUtc = new Date("2026-10-20T16:00:00.000Z"); // 21:30 IST

      const inRes = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: tokenIn.token,
          simulatedNow: inTimeUtc.toISOString(),
        });

      expect(inRes.status).toBe(200);
      expect(inRes.body.punchType).toBe("CHECK_IN");
      expect(inRes.body.record.dateKey).toBe("2026-10-20");

      // 2. Check out across midnight: 06:00 AM IST on 2026-10-21 (00:30 UTC on 2026-10-21)
      const tokenOut = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      const outTimeUtc = new Date("2026-10-21T00:30:00.000Z"); // 06:00 AM IST next day

      const outRes = await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          token: tokenOut.token,
          simulatedNow: outTimeUtc.toISOString(),
        });

      expect(outRes.status).toBe(200);
      expect(outRes.body.punchType).toBe("CHECK_OUT");
      expect(outRes.body.record.dateKey).toBe("2026-10-20"); // Attached to shift start day!
      expect(outRes.body.status).toBe(AttendanceStatus.CHECKED_OUT);
      expect(outRes.body.durationMinutes).toBe(510); // 8 hours 30 mins = 510 minutes

      // Verify no duplicate record was created for 2026-10-21
      const countDay2 = await AttendanceRecord.countDocuments({
        employee: employeeDoc._id,
        dateKey: "2026-10-21",
      });
      expect(countDay2).toBe(0);
    });
  });

  describe("Personal Attendance Queries (GET /attendance/today & /attendance/me)", () => {
    it("ignores simulatedNow outside test mode", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const response = await request(app)
          .get("/attendance/today?simulatedNow=2026-10-20T03:30:00.000Z")
          .set("Authorization", `Bearer ${employeeToken}`);
        expect(response.status).toBe(200);
        expect(response.body.dateKey).toBe(getDateKey(new Date(), "Asia/Kolkata"));
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it("returns today's current punch status via GET /attendance/today", async () => {
      // 1. Before punch
      const resBefore = await request(app)
        .get("/attendance/today")
        .set("Authorization", `Bearer ${employeeToken}`);

      expect(resBefore.status).toBe(200);
      expect(resBefore.body.hasPunched).toBe(false);
      expect(resBefore.body.canCheckIn).toBe(true);

      // 2. Punch check-in
      const t = await qrService.requestRotatingChallenge(
        pairedDisplay.displayId,
        pairedDisplay.credential
      );
      await request(app)
        .post("/attendance/scan")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ token: t.token });

      // 3. After check-in
      const resAfter = await request(app)
        .get("/attendance/today")
        .set("Authorization", `Bearer ${employeeToken}`);

      expect(resAfter.status).toBe(200);
      expect(resAfter.body.hasPunched).toBe(true);
      expect(resAfter.body.punchType).toBe("CHECKED_IN");
      expect(resAfter.body.canCheckOut).toBe(true);
    });

    it("returns personal history and aggregated metrics via GET /attendance/me", async () => {
      // Seed a few past records
      await AttendanceRecord.create([
        {
          employee: employeeDoc._id,
          employeeId: employeeDoc.employeeId,
          department: employeeDoc.department,
          dateKey: "2026-10-18",
          checkInTime: new Date("2026-10-18T03:30:00Z"),
          checkOutTime: new Date("2026-10-18T12:00:00Z"),
          durationMinutes: 510,
          status: AttendanceStatus.CHECKED_OUT,
          isLate: false,
        },
        {
          employee: employeeDoc._id,
          employeeId: employeeDoc.employeeId,
          department: employeeDoc.department,
          dateKey: "2026-10-19",
          checkInTime: new Date("2026-10-19T04:15:00Z"),
          checkOutTime: new Date("2026-10-19T12:15:00Z"),
          durationMinutes: 480,
          status: AttendanceStatus.CHECKED_OUT,
          isLate: true,
          lateMinutes: 45,
        },
      ]);

      const res = await request(app)
        .get("/attendance/me?month=2026-10")
        .set("Authorization", `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.stats.totalDays).toBe(2);
      expect(res.body.stats.presentDays).toBe(2);
      expect(res.body.stats.lateDays).toBe(1);
      expect(res.body.stats.totalWorkMinutes).toBe(990);
      expect(res.body.stats.attendancePercentage).toBe(100);
    });
  });
});
