import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { app } from "../src/app";
import { Employee, User, RegistrationOtp } from "../src/models";
import { ApiErrorCode, UserRole, WorkType } from "@vorldx/shared";
import { env } from "../src/config/env";
import { setMailAdapterForTesting } from "../src/services/mail";

describe("Employee Self-Registration Engine", () => {
  let lastDeliveredOtp = "";
  beforeEach(async () => {
    lastDeliveredOtp = "";
    setMailAdapterForTesting({
      name: "MockSmtpMailAdapter",
      sendMail: async (options) => {
        lastDeliveredOtp = options.text?.match(/\b\d{6}\b/)?.[0] || "";
        return { success: true };
      },
    });
    await RegistrationOtp.deleteMany({});
    await User.deleteMany({});
    await Employee.deleteMany({});
  });

  it("rejects register-start for unknown employee ID with 404 ERR_EMPLOYEE_NOT_FOUND", async () => {
    const res = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "NON-EXISTENT-999" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND);
    expect(res.body.message).toContain("Employee ID does not exist");
  });

  it("rejects register-start for inactive employee with 403 ERR_EMPLOYEE_INACTIVE", async () => {
    await Employee.create({
      employeeId: "EMP-INACTIVE",
      name: "Inactive Employee",
      email: "inactive@vorldx.demo",
      department: "Engineering",
      designation: "Former Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2023-01-01",
      isActive: false, // Inactive employee
    });

    const res = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "EMP-INACTIVE" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiErrorCode.ERR_EMPLOYEE_INACTIVE);
    expect(res.body.message).toContain("Employee profile is inactive");
  });

  it("rejects register-start for already registered employee with 409 ERR_ACCOUNT_ALREADY_REGISTERED", async () => {
    const existingUser = await User.create({
      employeeId: "EMP-EXISTS",
      email: "exists@vorldx.demo",
      passwordHash: "dummyHash",
      role: UserRole.EMPLOYEE,
      status: "ACTIVE",
    });

    await Employee.create({
      employeeId: "EMP-EXISTS",
      name: "Existing Employee",
      email: "exists@vorldx.demo",
      department: "Engineering",
      designation: "Full Stack Engineer",
      workType: WorkType.FULL_TIME,
      joiningDate: "2023-05-01",
      isActive: true,
      userId: existingUser._id,
    });

    const res = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "EMP-EXISTS" });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
    expect(res.body.message).toContain("Account is already registered");
  });

  it("web signup validates an assigned employee and creates exactly one linked User after demo OTP verification", async () => {
    await Employee.create({
      employeeId: "EMP-DEMO-01",
      name: "Demo Worker",
      email: "demo.worker@vorldx.demo",
      department: "Product",
      designation: "Product Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-01-15",
      isActive: true,
    });

    const originalNodeEnv = env.NODE_ENV;
    const originalDemoMode = env.DEMO_OTP_MODE;
    let emailSendCount = 0;
    setMailAdapterForTesting({
      name: "NoDeliveryDemoAdapter",
      sendMail: async () => {
        emailSendCount += 1;
        return { success: true };
      },
    });
    (env as { NODE_ENV: string }).NODE_ENV = "development";
    (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = true;

    const res = await request(app).post("/api/auth/signup").send({
      employeeId: "EMP-DEMO-01",
      email: "ignored.input@vorldx.demo",
      name: "Ignored Input",
      password: "StrongPassword123!",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.employeeId).toBe("EMP-DEMO-01");
    expect(res.body.email).toBe("demo.worker@vorldx.demo");
    expect(res.body.requiresOtpVerification).toBe(true);
    expect(res.body.simulatedDemoOtp).toBeDefined();
    expect(res.body.simulatedDemoOtp).toMatch(/^\d{6}$/);
    expect(res.body.demoNotice).toContain("SIMULATED OTP FOR DEMO ENVIRONMENT ONLY");
    expect(emailSendCount).toBe(0);
    expect(await User.countDocuments({ employeeId: "EMP-DEMO-01" })).toBe(0);

    const plainOtp = res.body.simulatedDemoOtp;

    // Verify DB record: plain-text OTP must NEVER be stored in the database!
    const otpDoc = await RegistrationOtp.findOne({ employeeId: "EMP-DEMO-01" });
    expect(otpDoc).not.toBeNull();
    expect(otpDoc?.hashedCode).not.toBe(plainOtp);
    // Hashed code must be a valid bcrypt hash verified against plain-text OTP
    const isBcryptMatch = await bcrypt.compare(plainOtp, otpDoc!.hashedCode);
    expect(isBcryptMatch).toBe(true);
    expect(otpDoc?.attempts).toBe(0);
    expect(otpDoc?.isUsed).toBe(false);

    const verifyRes = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-DEMO-01",
      otp: plainOtp,
      password: "StrongPassword123!",
    });
    expect(verifyRes.status).toBe(201);
    expect(await User.countDocuments({ employeeId: "EMP-DEMO-01" })).toBe(1);
    const linkedEmployee = await Employee.findOne({ employeeId: "EMP-DEMO-01" });
    expect(linkedEmployee?.userId?.toString()).toBe(verifyRes.body.user._id);

    const duplicateStart = await request(app)
      .post("/api/auth/signup")
      .send({ employeeId: "EMP-DEMO-01", email: "x@vorldx.demo", name: "Duplicate User", password: "StrongPassword123!" });
    expect(duplicateStart.status).toBe(409);
    expect(await User.countDocuments({ employeeId: "EMP-DEMO-01" })).toBe(1);

    (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
    (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = originalDemoMode;
    setMailAdapterForTesting(null);
  });

  it("rejects an unknown Employee ID from the web signup endpoint without creating records", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      employeeId: "UNKNOWN-EMP-01",
      email: "unused@vorldx.demo",
      name: "Unused Sample",
      password: "StrongPassword123!",
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND);
    expect(await User.countDocuments({})).toBe(0);
    expect(await Employee.countDocuments({})).toBe(0);
  });

  it("sends OTP through the existing mail adapter in live mode and never returns it", async () => {
    const originalNodeEnv = env.NODE_ENV;
    const originalDemoMode = env.DEMO_OTP_MODE;
    let delivery: { to?: string; text?: string } | undefined;
    setMailAdapterForTesting({
      name: "LiveDeliveryTestAdapter",
      sendMail: async (options) => {
        delivery = options;
        return { success: true };
      },
    });
    (env as { NODE_ENV: string }).NODE_ENV = "development";
    (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = false;

    await Employee.create({
      employeeId: "EMP-LIVE-01",
      name: "Live Demo Worker",
      email: "live.demo@vorldx.demo",
      department: "Demonstration",
      designation: "Sample Employee",
      workType: WorkType.FULL_TIME,
      joiningDate: "2026-01-01",
      isActive: true,
    });
    const res = await request(app).post("/api/auth/signup").send({
      employeeId: "EMP-LIVE-01",
      email: "untrusted@vorldx.demo",
      name: "Untrusted Input",
      password: "StrongPassword123!",
    });

    expect(res.status).toBe(201);
    expect(res.body.simulatedDemoOtp).toBeUndefined();
    expect(res.body.demoNotice).toBeUndefined();
    expect(delivery?.to).toBe("live.demo@vorldx.demo");
    expect(delivery?.text).toMatch(/\d{6}/);
    expect(res.body.email).toBe("live.demo@vorldx.demo");

    (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
    (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = originalDemoMode;
    setMailAdapterForTesting(null);
  });

  it("never returns simulated OTP when in production mode", async () => {
    const originalConfiguredNodeEnv = env.NODE_ENV;
    const originalDemoMode = env.DEMO_OTP_MODE;
    let emailSendCount = 0;
    setMailAdapterForTesting({
      name: "ProductionDeliveryTestAdapter",
      sendMail: async () => {
        emailSendCount += 1;
        return { success: true };
      },
    });

    try {
      // Force production mode
      (env as { NODE_ENV: string }).NODE_ENV = "production";
      (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = true;

      await Employee.create({
        employeeId: "EMP-PROD-01",
        name: "Prod Worker",
        email: "prod.worker@vorldx.demo",
        department: "Marketing",
        designation: "Growth Lead",
        workType: WorkType.FULL_TIME,
        joiningDate: "2024-02-01",
        isActive: true,
      });

      const res = await request(app)
        .post("/api/auth/mobile/register-start")
        .send({ employeeId: "EMP-PROD-01" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.simulatedDemoOtp).toBeUndefined();
      expect(res.body.demoNotice).toBeUndefined();
      expect(res.body.message).toContain("sent to registered employee email");
      expect(emailSendCount).toBe(1);
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = originalConfiguredNodeEnv;
      (env as { DEMO_OTP_MODE: boolean }).DEMO_OTP_MODE = originalDemoMode;
      setMailAdapterForTesting(null);
    }
  });

  it("rejects wrong OTP with 400 ERR_INVALID_OTP and increments attempts counter", async () => {
    await Employee.create({
      employeeId: "EMP-WRONG-OTP",
      name: "Check Attempts",
      email: "wrong.otp@vorldx.demo",
      department: "Operations",
      designation: "Support Lead",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-03-01",
      isActive: true,
    });

    // 1. Start registration
    await request(app).post("/api/auth/mobile/register-start").send({ employeeId: "EMP-WRONG-OTP" });

    // 2. Submit wrong OTP
    const res = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-WRONG-OTP",
      otp: "000000",
      password: "Password123!",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiErrorCode.ERR_INVALID_OTP);
    expect(res.body.message).toContain("Incorrect verification code");

    const otpDoc = await RegistrationOtp.findOne({ employeeId: "EMP-WRONG-OTP" });
    expect(otpDoc?.attempts).toBe(1);
  });

  it("uses registered email, stores only a hash, hides OTP, and enforces resend cooldown", async () => {
    await Employee.create({
      employeeId: "EMP-SMTP-OTP",
      name: "SMTP Employee",
      email: "registered.person@example.com",
      department: "Operations",
      designation: "Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-03-01",
      isActive: true,
    });
    const start = await request(app).post("/api/auth/mobile/register-start").send({ employeeId: "EMP-SMTP-OTP" });
    expect(start.status).toBe(200);
    expect(start.body.data.maskedEmail).toContain("@example.com");
    expect(JSON.stringify(start.body)).not.toContain(lastDeliveredOtp);
    expect(start.body.data.simulatedOtp).toBeUndefined();
    expect(lastDeliveredOtp).toMatch(/^\d{6}$/);

    const record = await RegistrationOtp.findOne({ employeeId: "EMP-SMTP-OTP" });
    expect(record?.email).toBe("registered.person@example.com");
    expect(record?.hashedCode).not.toBe(lastDeliveredOtp);
    expect(await bcrypt.compare(lastDeliveredOtp, record!.hashedCode)).toBe(true);
    expect(record!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(env.OTP_EXPIRY_MINUTES * 60_000);
    expect(record!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const blocked = await request(app).post("/api/auth/mobile/register-resend").send({ employeeId: "EMP-SMTP-OTP" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toContain("wait");

    await RegistrationOtp.updateOne({ _id: record!._id }, { $set: { createdAt: new Date(Date.now() - 61_000) } });
    const oldOtp = lastDeliveredOtp;
    const resend = await request(app).post("/api/auth/mobile/register-resend").send({ employeeId: "EMP-SMTP-OTP" });
    expect(resend.status).toBe(200);
    expect(lastDeliveredOtp).not.toBe(oldOtp);
    const replaced = await RegistrationOtp.findOne({ employeeId: "EMP-SMTP-OTP" });
    expect(await bcrypt.compare(oldOtp, replaced!.hashedCode)).toBe(false);
    expect(await bcrypt.compare(lastDeliveredOtp, replaced!.hashedCode)).toBe(true);
  });

  it("selects Nodemailer SMTP for mobile activation with a mocked sendMail", async () => {
    await Employee.create({
      employeeId: "EMP-MOCKED-SMTP",
      name: "SMTP Employee",
      email: "smtp.employee@example.com",
      department: "Operations",
      designation: "Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-03-01",
      isActive: true,
    });
    vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "false");
    vi.stubEnv("SMTP_USER", "test@example.com");
    vi.stubEnv("SMTP_PASS", "test-app-password");
    vi.stubEnv("SMTP_FROM_EMAIL", "test@example.com");
    vi.stubEnv("SMTP_FROM_NAME", "VORLDX INDUSTRIES PRIVATE LIMITED");
    setMailAdapterForTesting(null);
    const fakeTransport = {
      sendMail: vi.fn(async (options: { text?: string }) => {
        lastDeliveredOtp = options.text?.match(/\b\d{6}\b/)?.[0] || "";
        return { messageId: "mocked" };
      }),
      verify: vi.fn(async () => true),
    };
    const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue(fakeTransport as never);
    try {
      const response = await request(app).post("/api/auth/mobile/register-start").send({ employeeId: "EMP-MOCKED-SMTP" });
      expect(response.status).toBe(200);
      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true,
      }));
      expect(fakeTransport.sendMail).toHaveBeenCalledOnce();
      expect(JSON.stringify(response.body)).not.toContain(lastDeliveredOtp);
    } finally {
      createTransport.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("removes the pending mobile OTP and returns a safe error when SMTP delivery fails", async () => {
    await Employee.create({
      employeeId: "EMP-SMTP-FAIL",
      name: "SMTP Failure",
      email: "smtp.failure@example.com",
      department: "Operations",
      designation: "Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-03-01",
      isActive: true,
    });
    setMailAdapterForTesting({ name: "FailingMockSmtp", sendMail: async () => { throw new Error("provider error containing 123456"); } });
    const response = await request(app).post("/api/auth/mobile/register-start").send({ employeeId: "EMP-SMTP-FAIL" });
    expect(response.status).toBe(503);
    expect(response.body.message).not.toContain("123456");
    expect(await RegistrationOtp.countDocuments({ employeeId: "EMP-SMTP-FAIL" })).toBe(0);
  });

  it("enforces attempt limit and invalidates OTP after maximum failures", async () => {
    await Employee.create({
      employeeId: "EMP-MAX-ATTEMPTS",
      name: "Max Attempts User",
      email: "max.attempts@vorldx.demo",
      department: "Human Resources",
      designation: "HR Associate",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-03-15",
      isActive: true,
    });

    // Start registration
    await request(app).post("/api/auth/mobile/register-start").send({ employeeId: "EMP-MAX-ATTEMPTS" });

    // Fail 1st attempt
    const res1 = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-MAX-ATTEMPTS",
      otp: "111111",
      password: "Password123!",
    });
    expect(res1.status).toBe(400);
    expect(res1.body.code).toBe(ApiErrorCode.ERR_INVALID_OTP);

    // Fail 2nd attempt
    const res2 = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-MAX-ATTEMPTS",
      otp: "222222",
      password: "Password123!",
    });
    expect(res2.status).toBe(400);
    expect(res2.body.code).toBe(ApiErrorCode.ERR_INVALID_OTP);

    // Fail 3rd attempt (hits OTP_MAX_ATTEMPTS = 3)
    const res3 = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-MAX-ATTEMPTS",
      otp: "333333",
      password: "Password123!",
    });
    expect(res3.status).toBe(400);
    expect(res3.body.code).toBe(ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED);
    expect(res3.body.message).toContain("Maximum verification attempts exceeded");

    // Verify OTP document has been deleted/purged
    const otpDoc = await RegistrationOtp.findOne({ employeeId: "EMP-MAX-ATTEMPTS" });
    expect(otpDoc).toBeNull();
  });

  it("rejects expired OTP with 400 ERR_OTP_EXPIRED", async () => {
    await Employee.create({
      employeeId: "EMP-EXPIRED-OTP",
      name: "Expired OTP User",
      email: "expired.otp@vorldx.demo",
      department: "Engineering",
      designation: "QA Engineer",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-04-01",
      isActive: true,
    });

    const startRes = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "EMP-EXPIRED-OTP" });

    const plainOtp = lastDeliveredOtp;

    // Simulate OTP expiration in database
    await RegistrationOtp.updateOne(
      { employeeId: "EMP-EXPIRED-OTP" },
      { $set: { expiresAt: new Date(Date.now() - 5000) } }
    );

    const res = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-EXPIRED-OTP",
      otp: plainOtp,
      password: "ValidPassword123!",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiErrorCode.ERR_OTP_EXPIRED);
    expect(res.body.message).toContain("expired");
  });

  it("successfully registers employee, creates User account, links Employee, and allows login", async () => {
    const employee = await Employee.create({
      employeeId: "EMP-SUCCESS-99",
      name: "Suresh Pillai",
      email: "suresh.pillai@vorldx.demo",
      department: "Engineering",
      designation: "Senior Cloud Engineer",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-04-10",
      isActive: true,
    });

    // 1. Request registration OTP
    const startRes = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "EMP-SUCCESS-99" });

    expect(startRes.status).toBe(200);
    const simulatedOtp = lastDeliveredOtp;
    expect(simulatedOtp).toMatch(/^\d{6}$/);
    expect(startRes.body.simulatedDemoOtp).toBeUndefined();

    // 2. Verify OTP and set password
    const newPassword = "MyStrongSecurePassword123!";
    const verifyRes = await request(app).post("/api/auth/register-verify").send({
      employeeId: "EMP-SUCCESS-99",
      otp: simulatedOtp,
      password: newPassword,
    });

    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.refreshToken).toBeDefined();
    expect(verifyRes.body.user).toMatchObject({
      employeeId: "EMP-SUCCESS-99",
      email: "suresh.pillai@vorldx.demo",
      role: UserRole.EMPLOYEE,
      status: "ACTIVE",
    });
    expect(verifyRes.body.employee).toMatchObject({
      employeeId: "EMP-SUCCESS-99",
      name: "Suresh Pillai",
      department: "Engineering",
    });

    // Verify OTP single-use: record must be purged
    const remainingOtp = await RegistrationOtp.findOne({ employeeId: "EMP-SUCCESS-99" });
    expect(remainingOtp).toBeNull();

    // Verify Employee document updated with userId
    const updatedEmployee = await Employee.findById(employee._id);
    expect(updatedEmployee?.userId).toBeDefined();

    // 3. Verify user can now log in via standard POST /api/auth/login using their new password!
    const loginRes = await request(app).post("/api/auth/login").send({
      employeeId: "EMP-SUCCESS-99",
      password: newPassword,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.token).toBeDefined();

    // 4. Verify user can access GET /api/auth/me with access token
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.user.employeeId).toBe("EMP-SUCCESS-99");
    expect(meRes.body.employee.name).toBe("Suresh Pillai");
  });

  it("supports multi-step mobile registration: OTP verification followed by register-complete with verification token", async () => {
    await Employee.create({
      employeeId: "EMP-MOBILE-01",
      name: "Mobile Worker",
      email: "mobile.worker@vorldx.demo",
      department: "Mobile Team",
      designation: "React Native Specialist",
      workType: WorkType.FULL_TIME,
      joiningDate: "2024-05-01",
      isActive: true,
    });

    // Step 1: Start registration
    const startRes = await request(app)
      .post("/api/auth/mobile/register-start")
      .send({ employeeId: "EMP-MOBILE-01" });

    expect(startRes.status).toBe(200);
    const otp = lastDeliveredOtp;
    expect(otp).toMatch(/^\d{6}$/);
    expect(startRes.body.simulatedDemoOtp).toBeUndefined();

    // Step 2: Verify OTP without password (mobile UI Step 2)
    const verifyOtpRes = await request(app)
      .post("/api/auth/register-verify")
      .send({ employeeId: "EMP-MOBILE-01", otp });

    expect(verifyOtpRes.status).toBe(200);
    expect(verifyOtpRes.body.success).toBe(true);
    expect(verifyOtpRes.body.data.verificationToken).toBeDefined();
    const token = verifyOtpRes.body.data.verificationToken;

    // Step 3: Complete registration with verification token and password (mobile UI Step 3)
    const completeRes = await request(app)
      .post("/api/auth/register-complete")
      .send({
        employeeId: "EMP-MOBILE-01",
        verificationToken: token,
        password: "MobileSecure@123",
      });

    expect(completeRes.status).toBe(201);
    expect(completeRes.body.success).toBe(true);
    expect(completeRes.body.accessToken).toBeDefined();
    expect(completeRes.body.refreshToken).toBeDefined();
    expect(completeRes.body.user.employeeId).toBe("EMP-MOBILE-01");

    // Login with new credentials
    const loginRes = await request(app).post("/api/auth/login").send({
      employeeId: "EMP-MOBILE-01",
      password: "MobileSecure@123",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.employeeId).toBe("EMP-MOBILE-01");
  });
});
