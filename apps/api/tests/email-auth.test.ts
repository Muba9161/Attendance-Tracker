import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import {
  User,
  Employee,
  StaffInvitation,
  StaffSession,
  AuditEvent,
  RegistrationOtp,
  hashPassword,
} from "../src/models";
import { ConsoleMailAdapter } from "../src/services/mail/ConsoleMailAdapter";
import { BrevoMailDeliveryError } from "../src/services/mail/BrevoMailAdapter";
import { setMailAdapterForTesting } from "../src/services/mail";
import { ApiErrorCode, UserRole, WorkType } from "@vorldx/shared";
import { inMemoryMongoUri } from "./setup";
import { env } from "../src/config/env";
import { canViewNavItem, navGroups } from "../../web/src/components/layout/Sidebar";

describe("Email + Password Auth & Account Lifecycle Engine", () => {
  const mailAdapter = new ConsoleMailAdapter();
  setMailAdapterForTesting(mailAdapter);

  beforeEach(async () => {
    (env as { NODE_ENV: string }).NODE_ENV = "test";
    (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = false;
    await User.deleteMany({});
    await Employee.deleteMany({});
    await StaffInvitation.deleteMany({});
    await AuditEvent.deleteMany({});
    await RegistrationOtp.deleteMany({});
    mailAdapter.clearSentMails();
  });

  async function createUnlinkedEmployee(employeeId: string, email: string, name = "Sample Worker") {
    return Employee.create({
      employeeId,
      name,
      email,
      department: "Demonstration",
      designation: "Sample Employee",
      workType: WorkType.FULL_TIME,
      joiningDate: "2026-01-01",
      isActive: true,
    });
  }

  async function createAdminUser() {
    const passwordHash = await hashPassword("AdminSecure2026!");
    const user = await User.create({
      employeeId: "ADM-999",
      email: "super.admin@vorldx.demo",
      passwordHash,
      role: UserRole.ADMIN,
      status: "ACTIVE",
      isEmailVerified: true,
    });

    await Employee.create({
      employeeId: "ADM-999",
      name: "Super Admin",
      email: "super.admin@vorldx.demo",
      department: "Executive",
      designation: "Administrator",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-01-01",
      userId: user._id,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "super.admin@vorldx.demo", password: "AdminSecure2026!" });

    return { user, token: loginRes.body.token };
  }

  function getOtpFromLastMail(): string {
    const mails = mailAdapter.getSentMails();
    const html = mails[mails.length - 1]?.html || "";
    const otp = html.match(/letter-spacing:8px[^>]*>(\d{6})</)?.[1];
    if (!otp) throw new Error("The test mail did not contain a six-digit verification code.");
    return otp;
  }

  describe("POST /api/auth/signup", () => {
    it("starts registration for an assigned employee and sends OTP to the roster email", async () => {
      await createUnlinkedEmployee("EMP-NEW-001", "new.worker@vorldx.demo", "New Worker");
      const res = await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-NEW-001",
        email: "New.Worker@Vorldx.Demo",
        password: "ValidWorkerPassword123!",
        name: "New Worker",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.requiresOtpVerification).toBe(true);
      expect(res.body.employeeId).toBe("EMP-NEW-001");

      // The User is not created or linked until the OTP is verified.
      expect(await User.countDocuments({ employeeId: "EMP-NEW-001" })).toBe(0);

      // OTP delivery targets the employee record, not submitted signup fields.
      const mails = mailAdapter.getSentMails();
      expect(mails.length).toBe(1);
      expect(mails[0].to).toBe("new.worker@vorldx.demo");
      expect(mails[0].subject).toContain("verification code");
      expect(res.body).not.toHaveProperty("otp");
      const otp = getOtpFromLastMail();
      const otpRecord = await RegistrationOtp.findOne({ employeeId: "EMP-NEW-001" });
      expect(otpRecord).toBeDefined();
      expect(otpRecord!.hashedCode).not.toBe(otp);
      expect(await bcrypt.compare(otp, otpRecord!.hashedCode)).toBe(true);
      expect(otpRecord!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(env.OTP_EXPIRY_MINUTES * 60 * 1000);
      expect(otpRecord!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("hashes the password, logs in after verification, and persists across a database reconnect", async () => {
      const email = "persistent.worker@vorldx.demo";
      const password = "PersistentWorker2026!";
      await createUnlinkedEmployee("EMP-PERSIST-01", email, "Persistent Worker");

      const signupRes = await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-PERSIST-01",
        email,
        password,
        name: "Persistent Worker",
      });
      expect(signupRes.status).toBe(201);
      expect(await User.countDocuments({ email })).toBe(0);

      const verifyRes = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-PERSIST-01",
        otp: getOtpFromLastMail(),
        password,
      });
      expect(verifyRes.status).toBe(201);

      const savedUser = await User.findOne({ email });
      expect(savedUser).toBeDefined();
      expect(savedUser!.passwordHash).not.toBe(password);
      expect(await savedUser!.comparePassword(password)).toBe(true);
      expect((await Employee.findOne({ email }))?.userId?.toString()).toBe(savedUser!._id.toString());

      const loginRes = await request(app).post("/api/auth/login").send({ email, password });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();

      expect(inMemoryMongoUri).toBeTruthy();
      await mongoose.disconnect();
      await mongoose.connect(inMemoryMongoUri!);

      const persistedUser = await User.findOne({ email });
      expect(persistedUser).toBeDefined();
      expect(persistedUser!.passwordHash).not.toBe(password);
      const loginAfterReconnect = await request(app)
        .post("/api/auth/login")
        .send({ email, password });
      expect(loginAfterReconnect.status).toBe(200);
      expect(loginAfterReconnect.body.token).toBeDefined();
    });

    it("rejects weak password with validation error", async () => {
      const res = await request(app).post("/api/auth/signup").send({
        email: "weak@vorldx.demo",
        password: "weak", // < 8 characters, missing uppercase/number
        name: "Weak Pass User",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects duplicate email registration", async () => {
      await createUnlinkedEmployee("EMP-DUP-EMAIL", "duplicate@vorldx.demo", "Duplicate Worker");
      await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-DUP-EMAIL",
        email: "duplicate@vorldx.demo",
        password: "StrongPassword123!",
        name: "User One",
      });

      const verifyRes = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-DUP-EMAIL",
        otp: getOtpFromLastMail(),
        password: "StrongPassword123!",
      });
      expect(verifyRes.status).toBe(201);

      const res2 = await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-DUP-EMAIL",
        email: "Duplicate@vorldx.demo",
        password: "AnotherPassword123!",
        name: "User Two",
      });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe(ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
      expect(res2.body.message).toContain("already registered");
      expect(await User.countDocuments({ email: "duplicate@vorldx.demo" })).toBe(1);
    });

    it("allows an unlinked roster Employee ID and sends to its stored email", async () => {
      await Employee.create({
        employeeId: "EMP-TAKEN-1",
        name: "Directory Employee",
        email: "directory@vorldx.demo",
        department: "Operations",
        designation: "Employee",
        workType: WorkType.FULL_TIME,
        joiningDate: "2026-01-01",
      });

      const res = await request(app).post("/api/auth/signup").send({
        employeeId: "emp-taken-1",
        email: "new.email@vorldx.demo",
        password: "StrongWorker2026!",
        name: "New Worker",
      });

      expect(res.status).toBe(201);
      expect(res.body.employeeId).toBe("EMP-TAKEN-1");
      expect(mailAdapter.getSentMails()[0].to).toBe("directory@vorldx.demo");
      expect(await User.countDocuments({ email: "new.email@vorldx.demo" })).toBe(0);
    });

    it("rejects signup without an assigned Employee ID instead of allocating one", async () => {
      const res = await request(app).post("/api/auth/signup").send({
        email: "new.worker@vorldx.demo",
        password: "StrongWorker2026!",
        name: "New Worker",
      });

      expect(res.status).toBe(400);
      expect(res.body.errors?.some((issue: { field?: string }) => issue.field === "employeeId")).toBe(true);
      expect(await User.countDocuments({ email: "new.worker@vorldx.demo" })).toBe(0);
      expect(await Employee.countDocuments({ email: "new.worker@vorldx.demo" })).toBe(0);
    });

    it("role escalation prevention: assigned employee signup ignores requested ADMIN role", async () => {
      await createUnlinkedEmployee("ADM-ROLE-01", "role.sample@vorldx.demo");
      const res = await request(app).post("/api/auth/signup").send({
        employeeId: "ADM-ROLE-01",
        email: "hacker@vorldx.demo",
        password: "HackerPassword123!",
        name: "Malicious User",
        role: "ADMIN",
      });

      expect(res.status).toBe(201);
      const verified = await request(app).post("/api/auth/register-verify").send({
        employeeId: "ADM-ROLE-01",
        otp: getOtpFromLastMail(),
        password: "HackerPassword123!",
      });
      expect(verified.status).toBe(201);
      const user = await User.findOne({ employeeId: "ADM-ROLE-01" });
      expect(user!.role).toBe(UserRole.EMPLOYEE); // Role is strictly EMPLOYEE
    });

    it("does not grant HR based on a privileged-looking Employee ID or requested role", async () => {
      await createUnlinkedEmployee("HR-ROLE-01", "hr.role.sample@vorldx.demo");
      const signup = await request(app).post("/api/auth/signup").send({
        employeeId: "HR-ROLE-01",
        email: "hr.role.sample@vorldx.demo",
        password: "WorkerPassword123!",
        name: "Roster Worker",
        role: UserRole.HR,
      });

      expect(signup.status).toBe(201);
      const verify = await request(app).post("/api/auth/register-verify").send({
        employeeId: "HR-ROLE-01",
        otp: getOtpFromLastMail(),
        password: "WorkerPassword123!",
      });

      expect(verify.status).toBe(201);
      expect((await User.findOne({ employeeId: "HR-ROLE-01" }))?.role).toBe(UserRole.EMPLOYEE);
    });
  });

  describe("Signup email OTP verification", () => {
    it("successfully verifies a valid OTP", async () => {
      await createUnlinkedEmployee("EMP-VERIFY-01", "verify.me@vorldx.demo", "Verify Target");
      await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-VERIFY-01",
        email: "verify.me@vorldx.demo",
        password: "StrongPassword123!",
        name: "Verify Target",
      });

      expect(await User.findOne({ email: "verify.me@vorldx.demo" })).toBeNull();
      const res = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-VERIFY-01",
        otp: getOtpFromLastMail(),
        password: "StrongPassword123!",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const userAfter = await User.findOne({ email: "verify.me@vorldx.demo" });
      expect(userAfter!.status).toBe("ACTIVE");
      expect(await RegistrationOtp.countDocuments({ employeeId: userAfter!.employeeId })).toBe(0);
      expect((await Employee.findOne({ employeeId: "EMP-VERIFY-01" }))?.userId?.toString()).toBe(
        userAfter!._id.toString()
      );
    });

    it("rejects invalid email verification tokens on the legacy link endpoint", async () => {
      const res = await request(app).post("/api/auth/verify-email").send({
        token: "invalidtokenstring0000000000000000000000000000000000000000",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_INVALID_TOKEN);
    });

    it("rejects an expired signup OTP", async () => {
      await createUnlinkedEmployee("EMP-EXPIRED-01", "expired.verify@vorldx.demo", "Expired Verify User");
      await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-EXPIRED-01",
        email: "expired.verify@vorldx.demo",
        password: "StrongPassword123!",
        name: "Expired Verify User",
      });

      await RegistrationOtp.updateOne(
        { employeeId: "EMP-EXPIRED-01" },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      const res = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-EXPIRED-01",
        otp: getOtpFromLastMail(),
        password: "StrongPassword123!",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_OTP_EXPIRED);
    });

    it("rejects a wrong signup OTP and keeps the account unverified", async () => {
      await createUnlinkedEmployee("EMP-WRONG-01", "wrong.otp@vorldx.demo", "Wrong OTP User");
      await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-WRONG-01",
        email: "wrong.otp@vorldx.demo",
        password: "StrongPassword123!",
        name: "Wrong OTP User",
      });

      const res = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-WRONG-01",
        otp: "000000",
        password: "StrongPassword123!",
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Incorrect verification code");

      const user = await User.findOne({ email: "wrong.otp@vorldx.demo" });
      expect(user).toBeNull();
      const login = await request(app).post("/api/auth/login").send({
        email: "wrong.otp@vorldx.demo",
        password: "StrongPassword123!",
      });
      expect(login.status).toBe(401);
      expect(login.body.message).toContain("Invalid");
    });

    it("resends a demo/live OTP for the unlinked employee and invalidates the previous code", async () => {
      await createUnlinkedEmployee("EMP-RESEND-01", "resend.otp@vorldx.demo", "Resend OTP User");
      await request(app).post("/api/auth/signup").send({
        employeeId: "EMP-RESEND-01",
        email: "resend.otp@vorldx.demo",
        password: "StrongPassword123!",
        name: "Resend OTP User",
      });
      const oldOtp = getOtpFromLastMail();
      const resent = await request(app)
        .post("/api/auth/register-start")
        .send({ employeeId: "EMP-RESEND-01" });
      expect(resent.status).toBe(200);
      const newOtp = getOtpFromLastMail();
      expect(newOtp).not.toBe(oldOtp);

      const oldAttempt = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-RESEND-01",
        otp: oldOtp,
        password: "StrongPassword123!",
      });
      expect(oldAttempt.status).toBe(400);

      const verified = await request(app).post("/api/auth/register-verify").send({
        employeeId: "EMP-RESEND-01",
        otp: newOtp,
        password: "StrongPassword123!",
      });
      expect(verified.status).toBe(201);
      expect((await User.findOne({ employeeId: "EMP-RESEND-01" }))!.status).toBe("ACTIVE");
    });

    it("leaves the employee record intact and clears OTP when email delivery fails", async () => {
      await createUnlinkedEmployee("EMP-MAIL-FAIL", "mail.failure@vorldx.demo", "Mail Failure User");
      setMailAdapterForTesting({
        name: "FailingMailAdapter",
        sendMail: async () => {
          throw new Error("mock Brevo outage");
        },
      });
      try {
        const res = await request(app).post("/api/auth/signup").send({
          employeeId: "EMP-MAIL-FAIL",
          email: "mail.failure@vorldx.demo",
          password: "StrongPassword123!",
          name: "Mail Failure User",
        });
        expect(res.status).toBe(503);
        expect(res.body.message).toContain("could not send a verification code");
        expect(await User.countDocuments({ email: "mail.failure@vorldx.demo" })).toBe(0);
        expect(await Employee.countDocuments({ email: "mail.failure@vorldx.demo" })).toBe(1);
        expect(await RegistrationOtp.countDocuments({ email: "mail.failure@vorldx.demo" })).toBe(0);
      } finally {
        setMailAdapterForTesting(mailAdapter);
      }
    });

    it("explains Brevo authorized-IP rejection without exposing credentials or OTP", async () => {
      await createUnlinkedEmployee("EMP-BREVO-IP", "brevo.ip.block@vorldx.demo", "Brevo IP Block");
      setMailAdapterForTesting({
        name: "BrevoUnauthorizedIpAdapter",
        sendMail: async () => {
          throw new BrevoMailDeliveryError(
            401,
            "unauthorized",
            "We have detected you are using an unrecognised IP address 103.80.62.109."
          );
        },
      });
      try {
        const res = await request(app).post("/api/auth/signup").send({
          employeeId: "EMP-BREVO-IP",
          email: "brevo.ip.block@vorldx.demo",
          password: "StrongPassword123!",
          name: "Brevo IP Block",
        });
        expect(res.status).toBe(503);
        expect(res.body.message).toContain("103.80.62.109");
        expect(res.body.message).toContain("authorized IPs");
        expect(res.body.message).not.toContain("StrongPassword123!");
        expect(await User.countDocuments({ email: "brevo.ip.block@vorldx.demo" })).toBe(0);
      } finally {
        setMailAdapterForTesting(mailAdapter);
      }
    });
  });

  describe("POST /api/auth/forgot-password & reset-password", () => {
    it("returns generic anti-enumeration success message even for non-existent email", async () => {
      const res = await request(app).post("/api/auth/forgot-password").send({
        email: "nonexistent@vorldx.demo",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/dispatched/i);
      expect(mailAdapter.getSentMails().length).toBe(0); // Zero emails sent
    });

    it("sends password reset link to registered user and allows password reset", async () => {
      const passwordHash = await hashPassword("OldPassword123!");
      await User.create({
        employeeId: "EMP-RESET-1",
        email: "reset.target@vorldx.demo",
        passwordHash,
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
        isEmailVerified: true,
      });

      const forgotRes = await request(app).post("/api/auth/forgot-password").send({
        email: "reset.target@vorldx.demo",
      });

      expect(forgotRes.status).toBe(200);
      expect(forgotRes.body.success).toBe(true);

      const mails = mailAdapter.getSentMails();
      expect(mails.length).toBe(1);
      expect(mails[0].to).toBe("reset.target@vorldx.demo");
      const rawToken = mails[0].meta?.token || mails[0].html.match(/token=([a-f0-9]+)/)?.[1];
      expect(rawToken).toBeDefined();

      // Reset password with new password
      const resetRes = await request(app).post("/api/auth/reset-password").send({
        token: rawToken,
        password: "BrandNewSecurePassword123!",
      });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Verify old password is now rejected
      const oldLoginRes = await request(app).post("/api/auth/login").send({
        email: "reset.target@vorldx.demo",
        password: "OldPassword123!",
      });
      expect(oldLoginRes.status).toBe(401);

      // Verify new password succeeds
      const newLoginRes = await request(app).post("/api/auth/login").send({
        email: "reset.target@vorldx.demo",
        password: "BrandNewSecurePassword123!",
      });
      expect(newLoginRes.status).toBe(200);
    });

    it("rejects token reuse (single-use guarantee)", async () => {
      const passwordHash = await hashPassword("OldPassword123!");
      await User.create({
        employeeId: "EMP-RESET-2",
        email: "reuse.target@vorldx.demo",
        passwordHash,
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
        isEmailVerified: true,
      });

      await request(app).post("/api/auth/forgot-password").send({
        email: "reuse.target@vorldx.demo",
      });

      const rawToken = mailAdapter.getSentMails()[0].meta?.token || mailAdapter.getSentMails()[0].html.match(/token=([a-f0-9]+)/)?.[1];

      // First use succeeds
      const res1 = await request(app).post("/api/auth/reset-password").send({
        token: rawToken,
        password: "FirstResetPassword123!",
      });
      expect(res1.status).toBe(200);

      // Replay attempt must fail
      const res2 = await request(app).post("/api/auth/reset-password").send({
        token: rawToken,
        password: "SecondResetPassword123!",
      });
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe(ApiErrorCode.ERR_INVALID_TOKEN);
    });
  });

  describe("Staff Invitation Architecture (Security Model A)", () => {
    it("shows the HR Management navigation item only to Admin", () => {
      const hrManagement = navGroups.flatMap((group) => group.items).find((item) => item.href === "/hr-management");
      expect(hrManagement).toBeDefined();
      expect(canViewNavItem(hrManagement!, UserRole.ADMIN)).toBe(true);
      expect(canViewNavItem(hrManagement!, UserRole.HR)).toBe(false);
      expect(canViewNavItem(hrManagement!, UserRole.EMPLOYEE)).toBe(false);
    });

    it("keeps existing Admin credentials usable through the normal login endpoint", async () => {
      const { user, token } = await createAdminUser();

      expect(user.role).toBe(UserRole.ADMIN);
      expect(token).toBeTruthy();
    });

    it("keeps Employee login working through the existing login endpoint", async () => {
      const passwordHash = await hashPassword("EmployeeSecure2026!");
      await User.create({
        employeeId: "EMP-LOGIN-01",
        email: "employee.login@vorldx.demo",
        passwordHash,
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
        isEmailVerified: true,
      });
      const login = await request(app).post("/api/auth/login").send({
        email: "employee.login@vorldx.demo", password: "EmployeeSecure2026!",
      });
      expect(login.status).toBe(200);
      expect(login.body.user.role).toBe(UserRole.EMPLOYEE);
      expect(login.body.token).toBeTruthy();
    });

    it("does not issue Admin invitations outside the provisioning flow", async () => {
      const { token: adminToken } = await createAdminUser();
      const res = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "another.admin@vorldx.demo", role: UserRole.ADMIN });

      expect(res.status).toBe(400);
      expect(await StaffInvitation.countDocuments({ email: "another.admin@vorldx.demo" })).toBe(0);
    });

    it("super admin can generate staff invitation for HR role", async () => {
      const { token: adminToken } = await createAdminUser();

      const inviteRes = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: "New.Hr.Lead@vorldx.demo",
          role: UserRole.HR,
          name: "Divya HR",
          department: "Human Resources",
          designation: "HR Generalist",
        });

      expect(inviteRes.status).toBe(201);
      expect(inviteRes.body.success).toBe(true);
      expect(inviteRes.body.invitation.email).toBe("new.hr.lead@vorldx.demo");
      expect(inviteRes.body.invitation.role).toBe(UserRole.HR);

      // Verify email dispatched with invite token
      const mails = mailAdapter.getSentMails();
      expect(mails.length).toBe(1);
      expect(mails[0].to).toBe("new.hr.lead@vorldx.demo");
      const rawToken = mails[0].meta?.token || mails[0].html.match(/invite=([a-f0-9]+)/)?.[1];
      expect(rawToken).toBeDefined();

      // Verify invitation status via GET /api/auth/verify-invite
      const verifyInviteRes = await request(app)
        .get(`/api/auth/verify-invite?token=${rawToken}`);
      expect(verifyInviteRes.status).toBe(200);
      expect(verifyInviteRes.body.data.email).toBe("new.hr.lead@vorldx.demo");
      expect(verifyInviteRes.body.data.role).toBe(UserRole.HR);

      // Accept invite via POST /api/auth/signup with inviteToken
      const signupRes = await request(app).post("/api/auth/signup").send({
        email: "new.hr.lead@vorldx.demo",
        password: "HrSecurePassword123!",
        name: "Divya HR",
        inviteToken: rawToken,
      });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body.success).toBe(true);
      expect(signupRes.body.user.role).toBe(UserRole.HR); // Granted HR role via invitation

      const hrLogin = await request(app).post("/api/auth/login").send({
        email: "new.hr.lead@vorldx.demo",
        password: "HrSecurePassword123!",
      });
      expect(hrLogin.status).toBe(200);
      expect(hrLogin.body.user.role).toBe(UserRole.HR);

      // Account is pre-verified and active immediately
      const createdUser = await User.findOne({ email: "new.hr.lead@vorldx.demo" });
      expect(createdUser!.isEmailVerified).toBe(true);
      expect(createdUser!.status).toBe("ACTIVE");

      // Employee record was created
      const empRecord = await Employee.findOne({ email: "new.hr.lead@vorldx.demo" });
      expect(empRecord).toBeDefined();
      expect(empRecord!.department).toBe("Human Resources");

      // Verify invitation marked as accepted
      const invitationRecord = await StaffInvitation.findOne({ email: "new.hr.lead@vorldx.demo" });
      expect(invitationRecord!.isAccepted).toBe(true);
    });

    it("rejects an invalid invitation token without creating an account", async () => {
      const res = await request(app).post("/api/auth/signup").send({
        email: "invalid.invite@vorldx.demo",
        password: "HrSecurePassword123!",
        name: "Invalid Invite",
        inviteToken: "not-a-valid-invitation-token",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_TOKEN_EXPIRED);
      expect(await User.findOne({ email: "invalid.invite@vorldx.demo" })).toBeNull();
    });

    it("rejects an expired invitation without creating an account", async () => {
      const { user: admin } = await createAdminUser();
      const rawToken = crypto.randomBytes(32).toString("hex");
      await StaffInvitation.create({
        email: "expired.invite@vorldx.demo",
        role: UserRole.HR,
        tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
        invitedBy: admin._id,
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await request(app).post("/api/auth/signup").send({
        email: "expired.invite@vorldx.demo",
        password: "HrSecurePassword123!",
        name: "Expired Invite",
        inviteToken: rawToken,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_TOKEN_EXPIRED);
      expect(await User.findOne({ email: "expired.invite@vorldx.demo" })).toBeNull();
    });

    it("rejects an invitation email mismatch and leaves the invite unused", async () => {
      const { token: adminToken } = await createAdminUser();
      const inviteRes = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "invited.hr@vorldx.demo", role: UserRole.HR, name: "Invited HR" });
      const rawToken = mailAdapter.getSentMails()[0]?.meta?.token;

      expect(inviteRes.status).toBe(201);
      expect(rawToken).toBeTruthy();

      const signup = await request(app).post("/api/auth/signup").send({
        email: "different.person@vorldx.demo",
        password: "HrSecurePassword123!",
        name: "Different Person",
        inviteToken: rawToken,
      });

      expect(signup.status).toBe(400);
      expect(signup.body.code).toBe(ApiErrorCode.ERR_INVALID_INPUT);
      expect(await User.findOne({ email: "different.person@vorldx.demo" })).toBeNull();
      expect((await StaffInvitation.findOne({ email: "invited.hr@vorldx.demo" }))?.isAccepted).toBe(false);
    });

    it("rejects non-admin staff invitation creation (403 Forbidden)", async () => {
      // Create non-admin employee
      const passwordHash = await hashPassword("WorkerPass123!");
      await User.create({
        employeeId: "EMP-WRK-1",
        email: "regular.worker@vorldx.demo",
        passwordHash,
        role: UserRole.EMPLOYEE,
        status: "ACTIVE",
        isEmailVerified: true,
      });

      const workerLogin = await request(app).post("/api/auth/login").send({
        email: "regular.worker@vorldx.demo",
        password: "WorkerPass123!",
      });

      const workerToken = workerLogin.body.token;

      const forbiddenRes = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${workerToken}`)
        .send({
          email: "sneaky@vorldx.demo",
          role: UserRole.ADMIN,
        });

      expect(forbiddenRes.status).toBe(403);
    });

    it("allows HR to use operational APIs but denies Admin-only APIs and HR invitations", async () => {
      const { token: adminToken } = await createAdminUser();
      const invite = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "operations.hr@vorldx.demo", role: UserRole.HR });
      const rawToken = mailAdapter.getSentMails()[0]?.meta?.token;
      expect(invite.status).toBe(201);
      const accepted = await request(app).post("/api/auth/signup").send({
        email: "operations.hr@vorldx.demo",
        password: "HrSecurePassword123!",
        name: "Operations HR",
        inviteToken: rawToken,
      });
      expect(accepted.status).toBe(201);
      const login = await request(app).post("/api/auth/login").send({
        email: "operations.hr@vorldx.demo",
        password: "HrSecurePassword123!",
      });
      const hrToken = login.body.token as string;

      expect((await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/employees").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/attendance").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/displays").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/policy").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/wfh/admin/requests").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/reports/attendance").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${hrToken}`)).status).toBe(200);
      expect((await request(app).get("/api/auth/hr-management").set("Authorization", `Bearer ${hrToken}`)).status).toBe(403);
      expect((await request(app).get("/api/admin/feature-flags").set("Authorization", `Bearer ${hrToken}`)).status).toBe(403);
      expect((await request(app).post("/api/auth/invite").set("Authorization", `Bearer ${hrToken}`).send({
        email: "another.hr@vorldx.demo", role: UserRole.HR,
      })).status).toBe(403);
    });

    it("lets Admin list invitation states and deactivate/reactivate HR accounts", async () => {
      const { token: adminToken } = await createAdminUser();
      const admin = await User.findOne({ role: UserRole.ADMIN });
      const expiredTokenHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
      await StaffInvitation.create({
        email: "expired.lifecycle.hr@vorldx.demo",
        role: UserRole.HR,
        tokenHash: expiredTokenHash,
        invitedBy: admin!._id,
        expiresAt: new Date(Date.now() - 1000),
      });
      const invite = await request(app)
        .post("/api/auth/invite")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: "lifecycle.hr@vorldx.demo", role: UserRole.HR });
      expect(invite.status).toBe(201);
      const pendingList = await request(app)
        .get("/api/auth/hr-management")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(pendingList.status).toBe(200);
      expect(pendingList.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ email: "lifecycle.hr@vorldx.demo", role: UserRole.HR, invitationStatus: "Pending" }),
        expect.objectContaining({ email: "expired.lifecycle.hr@vorldx.demo", role: UserRole.HR, invitationStatus: "Expired" }),
      ]));

      const rawToken = mailAdapter.getSentMails()[0]?.meta?.token;
      const accepted = await request(app).post("/api/auth/signup").send({
        email: "lifecycle.hr@vorldx.demo", password: "HrSecurePassword123!", name: "Lifecycle HR", inviteToken: rawToken,
      });
      const hrUser = await User.findOne({ email: "lifecycle.hr@vorldx.demo" });
      expect(accepted.status).toBe(201);
      expect(hrUser).toBeTruthy();
      const acceptedList = await request(app)
        .get("/api/auth/hr-management")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(acceptedList.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ email: "lifecycle.hr@vorldx.demo", invitationStatus: "Accepted" }),
      ]));
      const hrLogin = await request(app).post("/api/auth/login").send({
        email: "lifecycle.hr@vorldx.demo", password: "HrSecurePassword123!",
      });
      expect(hrLogin.status).toBe(200);
      await StaffSession.create({
        user: hrUser!._id,
        tokenHash: "test-session-hash",
        ipAddress: "127.0.0.1",
        userAgent: "test",
        isActive: true,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const inactive = await request(app)
        .patch(`/api/auth/hr-management/${hrUser!._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "INACTIVE" });
      expect(inactive.status).toBe(200);
      expect((await StaffSession.findOne({ user: hrUser!._id }))?.isActive).toBe(false);
      const oldToken = hrLogin.body.token as string;
      expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${oldToken}`)).status).toBe(401);
      expect((await request(app).post("/api/auth/login").send({ email: "lifecycle.hr@vorldx.demo", password: "HrSecurePassword123!" })).status).toBe(403);

      const reactivated = await request(app)
        .patch(`/api/auth/hr-management/${hrUser!._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "ACTIVE" });
      expect(reactivated.status).toBe(200);
      expect((await request(app).post("/api/auth/login").send({ email: "lifecycle.hr@vorldx.demo", password: "HrSecurePassword123!" })).status).toBe(200);
    });
  });
});
