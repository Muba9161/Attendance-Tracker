import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import {
  User,
  Employee,
  TrustedDevice,
  StaffSession,
  AuditEvent,
  hashPassword,
} from "../src/models";
import { ApiErrorCode, UserRole, WorkType } from "@vorldx/shared";

describe("Staff Authentication & Session Management", () => {
  const staffEmail = "admin.staff@vorldx.demo";
  const staffPassword = "AdminStaffPassword123!";
  const hrEmail = "hr.staff@vorldx.demo";
  const hrPassword = "HrStaffPassword123!";

  beforeEach(async () => {
    await User.deleteMany({});
    await Employee.deleteMany({});
    await TrustedDevice.deleteMany({});
    await StaffSession.deleteMany({});
    await AuditEvent.deleteMany({});
  });

  async function createStaffUser(
    role: UserRole = UserRole.ADMIN,
    email = staffEmail,
    password = staffPassword
  ) {
    const passwordHash = await hashPassword(password);
    const user = await User.create({
      employeeId: role === UserRole.ADMIN ? "ADM-101" : "HR-101",
      email: email.toLowerCase(),
      passwordHash,
      role,
      status: "ACTIVE",
      isEmailVerified: true,
    });

    const employee = await Employee.create({
      employeeId: user.employeeId,
      name: role === UserRole.ADMIN ? "Super Admin" : "HR Manager",
      email: user.email,
      department: "Management",
      designation: "Executive",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-01-01",
      userId: user._id,
    });

    return { user, employee };
  }

  it("confirms legacy staff OTP endpoints return 404 Not Found", async () => {
    const startRes = await request(app)
      .post("/api/auth/staff/otp-start")
      .send({ mobileNumber: "+919876543210" });
    expect(startRes.status).toBe(404);

    const verifyRes = await request(app)
      .post("/api/auth/staff/otp-verify")
      .send({ mobileNumber: "+919876543210", otp: "123456" });
    expect(verifyRes.status).toBe(404);
  });

  it("lists active sessions and revokes a specific session after email/password login", async () => {
    const { user } = await createStaffUser(UserRole.ADMIN, staffEmail, staffPassword);

    // Log in via email + password
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: staffEmail, password: staffPassword });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();

    const token = loginRes.body.token;

    // Verify session was created for staff
    const sessions = await StaffSession.find({ user: user._id });
    expect(sessions.length).toBe(1);
    expect(sessions[0].isActive).toBe(true);

    const sessionId = sessions[0]._id.toString();

    // List sessions via API
    const listRes = await request(app)
      .get("/api/auth/staff/sessions")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

    // Revoke the session
    const revokeRes = await request(app)
      .delete(`/api/auth/staff/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    const updatedSession = await StaffSession.findById(sessionId);
    expect(updatedSession!.isActive).toBe(false);
  });

  it("super admin can force logout an HR staff user and terminate their sessions", async () => {
    const { user: adminUser } = await createStaffUser(UserRole.ADMIN, staffEmail, staffPassword);
    const { user: hrUser } = await createStaffUser(UserRole.HR, hrEmail, hrPassword);

    // HR logs in
    const hrLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: hrEmail, password: hrPassword });
    const hrToken = hrLogin.body.token;

    const hrSession = await StaffSession.findOne({ user: hrUser._id, isActive: true });
    expect(hrSession).toBeDefined();

    // Admin logs in
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: staffEmail, password: staffPassword });
    const adminToken = adminLogin.body.token;

    // Admin executes force logout on HR user
    const forceRes = await request(app)
      .post(`/api/auth/staff/force-logout/${hrUser._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Security audit credential rotation" });

    expect(forceRes.status).toBe(200);
    expect(forceRes.body.success).toBe(true);

    // Verify HR session terminated in DB
    const terminatedSession = await StaffSession.findById(hrSession!._id);
    expect(terminatedSession!.isActive).toBe(false);

    // HR user's refresh token is invalidated
    const reloadedHr = await User.findById(hrUser._id);
    expect(reloadedHr!.refreshTokenHash).toBeNull();
  });

  it("lists and revokes trusted devices", async () => {
    const { user } = await createStaffUser(UserRole.ADMIN, staffEmail, staffPassword);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: staffEmail, password: staffPassword });
    const token = loginRes.body.token;

    // Create a trusted device
    const device = await TrustedDevice.create({
      user: user._id,
      deviceFingerprint: "device_mac_pro_m3",
      deviceName: "Kirtee MacBook Pro",
      platform: "macOS",
      trustedUntil: new Date(Date.now() + 30 * 86400000),
      isRevoked: false,
    });

    // List devices
    const listRes = await request(app)
      .get("/api/auth/staff/devices")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].deviceName).toBe("Kirtee MacBook Pro");

    // Revoke device
    const revokeRes = await request(app)
      .delete(`/api/auth/staff/devices/${device._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    const updatedDevice = await TrustedDevice.findById(device._id);
    expect(updatedDevice!.isRevoked).toBe(true);
  });
});
