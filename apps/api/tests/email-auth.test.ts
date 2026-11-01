import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import {
  User,
  Employee,
  StaffInvitation,
  AuditEvent,
  hashPassword,
} from "../src/models";
import { ConsoleMailAdapter } from "../src/services/mail/ConsoleMailAdapter";
import { getMailAdapter } from "../src/services/mail";
import { ApiErrorCode, UserRole, WorkType } from "@vorldx/shared";

describe("Email + Password Auth & Account Lifecycle Engine", () => {
  const mailAdapter = getMailAdapter() as ConsoleMailAdapter;

  beforeEach(async () => {
    await User.deleteMany({});
    await Employee.deleteMany({});
    await StaffInvitation.deleteMany({});
    await AuditEvent.deleteMany({});
    mailAdapter.clearSentMails();
  });

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

  describe("POST /api/auth/signup", () => {
    it("successfully creates employee account in pending verification state and sends email", async () => {
      const res = await request(app).post("/api/auth/signup").send({
        email: "New.Worker@Vorldx.Demo",
        password: "ValidWorkerPassword123!",
        name: "New Worker",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.requiresEmailVerification).toBe(true);

      // Verify user in database
      const user = await User.findOne({ email: "new.worker@vorldx.demo" });
      expect(user).toBeDefined();
      expect(user!.email).toBe("new.worker@vorldx.demo"); // Stored in lowercase
      expect(user!.role).toBe(UserRole.EMPLOYEE);
      expect(user!.status).toBe("PENDING_VERIFICATION");
      expect(user!.isEmailVerified).toBe(false);
      expect(user!.emailVerificationTokenHash).toBeDefined();

      // Verify verification email dispatched
      const mails = mailAdapter.getSentMails();
      expect(mails.length).toBe(1);
      expect(mails[0].to).toBe("new.worker@vorldx.demo");
      expect(mails[0].subject).toContain("Verify Your VorldX Account");
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
      await request(app).post("/api/auth/signup").send({
        email: "duplicate@vorldx.demo",
        password: "StrongPassword123!",
        name: "User One",
      });

      const res2 = await request(app).post("/api/auth/signup").send({
        email: "Duplicate@vorldx.demo",
        password: "AnotherPassword123!",
        name: "User Two",
      });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe(ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
    });

    it("role escalation prevention: open signup ignores any requested ADMIN/HR role", async () => {
      const res = await request(app).post("/api/auth/signup").send({
        email: "hacker@vorldx.demo",
        password: "HackerPassword123!",
        name: "Malicious User",
        role: "ADMIN",
      });

      expect(res.status).toBe(201);
      const user = await User.findOne({ email: "hacker@vorldx.demo" });
      expect(user!.role).toBe(UserRole.EMPLOYEE); // Role is strictly EMPLOYEE
    });
  });

  describe("POST /api/auth/verify-email", () => {
    it("successfully verifies email with valid token", async () => {
      await request(app).post("/api/auth/signup").send({
        email: "verify.me@vorldx.demo",
        password: "StrongPassword123!",
        name: "Verify Target",
      });

      const userBefore = await User.findOne({ email: "verify.me@vorldx.demo" });
      expect(userBefore!.emailVerificationTokenHash).toBeDefined();

      const mails = mailAdapter.getSentMails();
      const rawToken = mails[0].meta?.token || mails[0].html.match(/token=([a-f0-9]+)/)?.[1];
      expect(rawToken).toBeDefined();

      const res = await request(app).post("/api/auth/verify-email").send({
        token: rawToken,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const userAfter = await User.findOne({ email: "verify.me@vorldx.demo" });
      expect(userAfter!.status).toBe("ACTIVE");
      expect(userAfter!.isEmailVerified).toBe(true);
      expect(userAfter!.emailVerificationTokenHash).toBeNull();
    });

    it("rejects invalid or tampered email verification token", async () => {
      const res = await request(app).post("/api/auth/verify-email").send({
        token: "invalidtokenstring0000000000000000000000000000000000000000",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_INVALID_TOKEN);
    });

    it("rejects expired email verification token", async () => {
      await request(app).post("/api/auth/signup").send({
        email: "expired.verify@vorldx.demo",
        password: "StrongPassword123!",
        name: "Expired Verify User",
      });

      const mails = mailAdapter.getSentMails();
      const rawToken = mails[0].meta?.token || mails[0].html.match(/token=([a-f0-9]+)/)?.[1];

      // Fast-forward token expiration to past
      await User.updateOne(
        { email: "expired.verify@vorldx.demo" },
        { $set: { emailVerificationExpiresAt: new Date(Date.now() - 1000) } }
      );

      const res = await request(app).post("/api/auth/verify-email").send({
        token: rawToken,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiErrorCode.ERR_TOKEN_EXPIRED);
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
  });
});
