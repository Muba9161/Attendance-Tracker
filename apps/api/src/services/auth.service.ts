import crypto from "crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { User, IUser, hashPassword } from "../models/User";
import { Employee, IEmployee } from "../models/Employee";
import { RegistrationOtp } from "../models/RegistrationOtp";
import { IStaffInvitation, StaffInvitation } from "../models/StaffInvitation";
import { StaffSession } from "../models/StaffSession";
import { AuditEvent } from "../models/AuditEvent";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger";
import { eventEmitterService } from "./eventEmitter.service";
import { reauthorizeUserSockets } from "../sockets/socketServer";
import { BrevoMailDeliveryError, getBrevoMailAdapter, getMailAdapter, getSmtpMailAdapter } from "./mail";
import { ApiErrorCode, UserRole, WorkType, isPasswordStrong } from "@vorldx/shared";

function getSignupDuplicateField(error: unknown): string | undefined {
  const mongoError = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
    message?: string;
  };

  if (mongoError?.code !== 11000) return undefined;

  const indexedField = Object.keys(mongoError.keyPattern || mongoError.keyValue || {})[0];
  if (indexedField) return indexedField;

  const indexMatch = mongoError.message?.match(/index:\s+[^\s]*?(email|employeeId)_1\b/i);
  return indexMatch?.[1]?.toLowerCase();
}

function getSignupDuplicateError(field?: string): AppError {
  if (field === "email") {
    return AppError.conflict(
      "An account with this email address already exists.",
      ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
    );
  }

  if (field === "employeeId") {
    return AppError.conflict(
      "The employee ID was claimed during registration. Please retry signup.",
      ApiErrorCode.ERR_BAD_REQUEST
    );
  }

  return AppError.conflict(
    "A signup record conflicts with an existing unique account field.",
    ApiErrorCode.ERR_BAD_REQUEST
  );
}

function getSignupEmailDeliveryErrorMessage(error: unknown): string {
  if (
    error instanceof BrevoMailDeliveryError &&
    error.providerCode === "unauthorized" &&
    /unrecognised IP address/i.test(error.providerMessage)
  ) {
    const ipAddress = error.providerMessage.match(/unrecognised IP address\s+([0-9.]+)/i)?.[1];
    return ipAddress
      ? `Brevo blocked this server IP (${ipAddress}). Add it to the authorized IPs for this Brevo API key, then retry signup.`
      : "Brevo blocked this server IP. Add the server's outbound IP to the authorized IPs for this Brevo API key, then retry signup.";
  }
  return "We could not send a verification code. Please check the email service configuration and try again.";
}

export interface TokenPayload {
  userId: string;
  employeeId: string;
  email: string;
  role: UserRole;
}

export interface RegisterStartResult {
  employeeId: string;
  email: string;
  expiresInMinutes: number;
  resendAfterSeconds: number;
  simulatedDemoOtp?: string;
  isDemoMode?: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    _id: string;
    employeeId: string;
    email: string;
    role: UserRole;
    status: string;
  };
  employee: {
    _id: string;
    employeeId: string;
    name: string;
    email: string;
    department: string;
    designation: string;
    workType: string;
    shiftId?: string | null;
  } | null;
}

export class AuthService {
  /** Creates an active HR login directly for an administrator when mail setup is unavailable. */
  public async createHrAccountWithPassword(
    adminUserId: string,
    input: { name: string; email: string; department: string; designation: string; password: string }
  ): Promise<{
    success: true;
    message: string;
    data: { id: string; email: string; employeeId: string; role: UserRole.HR; status: string };
  }> {
    const admin = await User.findById(adminUserId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw AppError.forbidden("Only system administrators can create HR accounts.", ApiErrorCode.ERR_FORBIDDEN);
    }
    if (!isPasswordStrong(input.password)) {
      throw AppError.badRequest(
        "Password must be at least 8 characters and contain uppercase, lowercase, and a number or symbol.",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const email = input.email.trim().toLowerCase();
    if (await User.exists({ email })) {
      throw AppError.conflict("A user account with this email already exists.", ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
    }
    if (await Employee.exists({ email })) {
      throw AppError.conflict("An employee profile with this email already exists.", ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
    }

    let employeeId = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `HR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const [userExists, employeeExists] = await Promise.all([
        User.exists({ employeeId: candidate }),
        Employee.exists({ employeeId: candidate }),
      ]);
      if (!userExists && !employeeExists) {
        employeeId = candidate;
        break;
      }
    }
    if (!employeeId) throw AppError.internal("Unable to allocate a unique HR employee ID.");

    const user = await User.create({
      employeeId,
      email,
      passwordHash: await hashPassword(input.password),
      role: UserRole.HR,
      status: "ACTIVE",
      isEmailVerified: true,
      refreshTokenHash: null,
    });

    try {
      await Employee.create({
        employeeId,
        name: input.name.trim(),
        email,
        department: input.department.trim(),
        designation: input.designation.trim(),
        workType: WorkType.FULL_TIME,
        joiningDate: new Date().toISOString().slice(0, 10),
        isActive: true,
        userId: user._id,
      });
    } catch (error: unknown) {
      await User.deleteOne({ _id: user._id });
      const dbError = error as { code?: number };
      if (dbError.code === 11000) {
        throw AppError.conflict("An account or employee profile already uses this email or ID.", ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
      }
      throw error;
    }

    try {
      await StaffInvitation.deleteMany({ email, role: UserRole.HR, isAccepted: false });
      await AuditEvent.create({
        entityType: "USER",
        entityId: user._id.toString(),
        performedBy: admin._id,
        performedByEmployeeId: admin.employeeId,
        action: "HR_ACCOUNT_CREATED_BY_ADMIN",
        reason: `Created an HR account for ${email}`,
        timestamp: new Date(),
        metadata: { targetEmail: email, employeeId, role: UserRole.HR },
      });
    } catch (error: unknown) {
      logger.error("HR account was created but follow-up cleanup or audit logging failed", {
        userId: user._id.toString(),
        reason: error instanceof Error ? error.message : "Unknown database error",
      });
    }

    return {
      success: true,
      message: "HR account created. The teammate can sign in with the email and password set by the administrator.",
      data: { id: user._id.toString(), email, employeeId, role: UserRole.HR, status: user.status },
    };
  }

  private async deliverSignupOtp(
    email: string,
    name: string,
    otp: string,
    expiresInMinutes = 5
  ): Promise<void> {
    const safeName = name.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
    const delivery = await getBrevoMailAdapter().sendMail({
      to: email,
      subject: "Your VORLDX employee signup verification code",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>VORLDX Employee Attendance System</h2><p>Hello ${safeName},</p><p>Use this one-time password to verify your employee account:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;padding:16px;background:#f1f5f9;text-align:center">${otp}</p><p>This code expires in ${expiresInMinutes} minutes.</p><p style="color:#b42318"><strong>Security:</strong> Never share this code with anyone. VORLDX staff will never ask you for it.</p></div>`,
      text: `VORLDX Employee Attendance System\n\nHello ${name},\n\nYour account verification code is ${otp}. It expires in ${expiresInMinutes} minutes.\n\nNever share this code with anyone.`,
      meta: { type: "SIGNUP_OTP", recipientName: name, role: UserRole.EMPLOYEE },
    });
    if (!delivery.success) throw new Error("Brevo did not accept the verification email.");
  }

  private async deliverMobileActivationOtp(email: string, name: string, otp: string): Promise<void> {
    const safeName = name.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    await getSmtpMailAdapter().sendMail({
      to: email,
      subject: "Your VORLDX account activation code",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>VORLDX INDUSTRIES PRIVATE LIMITED</h2><p>Hello ${safeName},</p><p>Verification code sent to your registered email.</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;padding:16px;background:#f1f5f9;text-align:center">${otp}</p><p>This code expires in ${env.OTP_EXPIRY_MINUTES} minutes. Never share this code.</p></div>`,
      text: `VORLDX INDUSTRIES PRIVATE LIMITED\n\nHello ${name},\nVerification code sent to your registered email.\nYour activation code is ${otp}. It expires in ${env.OTP_EXPIRY_MINUTES} minutes. Never share this code.`,
      meta: { type: "SIGNUP_OTP", recipientName: name, role: UserRole.EMPLOYEE },
    });
  }

  /**
   * Generates a short-lived JWT access token
   */
  public generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });
  }

  /**
   * Generates a cryptographically secure random refresh token string
   */
  public generateRefreshToken(): string {
    return crypto.randomBytes(40).toString("hex");
  }

  /**
   * Hashes a refresh token with SHA-256 for secure storage
   */
  public hashRefreshToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Authenticates user credentials with lockout protection
   */
  public async login(
    identifier: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string; deviceId?: string }
  ): Promise<LoginResult> {
    const trimmedId = identifier.trim();
    // Support lookup by uppercase employeeId or lowercase email
    const user = await User.findOne({
      $or: [{ employeeId: trimmedId.toUpperCase() }, { email: trimmedId.toLowerCase() }],
    });

    if (!user) {
      await AuditEvent.create({
        entityType: "AUTH",
        entityId: "unknown",
        action: "LOGIN_FAILED",
        reason: "Unknown user / invalid identifier",
        timestamp: new Date(),
        metadata: { identifier: trimmedId },
      });
      throw AppError.unauthorized("Invalid email or password", ApiErrorCode.ERR_INVALID_CREDENTIALS);
    }

    if (user.status === "INACTIVE") {
      throw AppError.forbidden(
        "Account is disabled. Please contact HR.",
        ApiErrorCode.ERR_FORBIDDEN
      );
    }

    if (user.status === "PENDING_VERIFICATION") {
      throw AppError.unauthorized(
        "Please verify your email address before signing in.",
        ApiErrorCode.ERR_UNAUTHORIZED
      );
    }

    // A valid password can recover a temporarily locked account immediately.
    // Failed passwords remain blocked until the normal lockout expires.
    const isAccountLocked = Boolean(user.lockoutUntil && user.lockoutUntil.getTime() > Date.now());
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      if (isAccountLocked) {
        throw new AppError(
          423,
          ApiErrorCode.ERR_ACCOUNT_LOCKED,
          "Account is temporarily locked after repeated failed attempts. Enter the correct password or reset it to regain access."
        );
      }

      const attempts = (user.failedLoginAttempts || 0) + 1;
      if (attempts >= env.MAX_LOGIN_ATTEMPTS) {
        const lockoutUntil = new Date(Date.now() + env.LOCKOUT_MINUTES * 60 * 1000);
        await User.findByIdAndUpdate(user._id, {
          $set: {
            failedLoginAttempts: attempts,
            lockoutUntil,
          },
        });
        await AuditEvent.create({
          entityType: "AUTH",
          entityId: user._id.toString(),
          action: "ACCOUNT_LOCKED",
          reason: `Locked after ${attempts} consecutive failed attempts`,
          timestamp: new Date(),
          metadata: { lockoutUntil, email: user.email },
        });
        throw new AppError(
          423,
          ApiErrorCode.ERR_ACCOUNT_LOCKED,
          `Account is temporarily locked after ${env.MAX_LOGIN_ATTEMPTS} consecutive failed login attempts. Enter the correct password or reset it to regain access.`
        );
      }

      await User.findByIdAndUpdate(user._id, {
        $set: { failedLoginAttempts: attempts },
      });

      await AuditEvent.create({
        entityType: "AUTH",
        entityId: user._id.toString(),
        action: "LOGIN_FAILED",
        reason: "Incorrect password",
        timestamp: new Date(),
        metadata: { attempts, email: user.email },
      });

      throw AppError.unauthorized("Invalid email or password", ApiErrorCode.ERR_INVALID_CREDENTIALS);
    }

    // Successful authentication: issue tokens and reset failed attempts
    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: new Date(),
        refreshTokenHash,
      },
    });

    await AuditEvent.create({
      entityType: "AUTH",
      entityId: user._id.toString(),
      performedBy: user._id,
      performedByEmployeeId: user.employeeId,
      action: "LOGIN_SUCCESS",
      timestamp: new Date(),
      metadata: { email: user.email, role: user.role },
    });

    if (user.role === UserRole.ADMIN || user.role === UserRole.HR) {
      const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
      await StaffSession.create({
        user: user._id,
        tokenHash: refreshTokenHash,
        ipAddress: meta?.ipAddress || "127.0.0.1",
        userAgent: meta?.userAgent || "unknown",
        isActive: true,
        expiresAt,
        lastActivityAt: new Date(),
      });
    }

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      employeeId: user.employeeId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.generateAccessToken(tokenPayload);

    // Retrieve corresponding employee details if available
    const employee = await Employee.findOne({ employeeId: user.employeeId });

    return {
      accessToken,
      refreshToken,
      user: {
        _id: user._id.toString(),
        employeeId: user.employeeId,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      employee: employee
        ? {
          _id: employee._id.toString(),
          employeeId: employee.employeeId,
          name: employee.name,
          email: employee.email,
          department: employee.department,
          designation: employee.designation,
          workType: employee.workType,
          shiftId: employee.shiftId ? employee.shiftId.toString() : null,
        }
        : null,
    };
  }

  /**
   * Rotates a refresh token and returns a new access token + refresh token
   */
  public async refreshToken(
    providedRefreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!providedRefreshToken) {
      throw AppError.unauthorized("Refresh token is required", ApiErrorCode.ERR_UNAUTHORIZED);
    }

    const hash = this.hashRefreshToken(providedRefreshToken);
    const user = await User.findOne({
      refreshTokenHash: hash,
      status: { $ne: "INACTIVE" },
    });

    if (!user) {
      throw AppError.unauthorized(
        "Invalid or expired refresh token",
        ApiErrorCode.ERR_UNAUTHORIZED
      );
    }

    // Rotate refresh token
    const newRefreshToken = this.generateRefreshToken();
    const newHash = this.hashRefreshToken(newRefreshToken);

    await User.findByIdAndUpdate(user._id, {
      $set: { refreshTokenHash: newHash },
    });

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      employeeId: user.employeeId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.generateAccessToken(tokenPayload);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Invalidates a user's active refresh token upon logout
   */
  public async logout(userId?: string, refreshToken?: string): Promise<void> {
    if (userId) {
      await User.findByIdAndUpdate(userId, { $set: { refreshTokenHash: null } });
    } else if (refreshToken) {
      const hash = this.hashRefreshToken(refreshToken);
      await User.findOneAndUpdate({ refreshTokenHash: hash }, { $set: { refreshTokenHash: null } });
    }
  }

  /**
   * Retrieves current authenticated user profile and associated employee data
   */
  public async getCurrentUser(
    userId: string
  ): Promise<{ user: Partial<IUser>; employee: Partial<IEmployee> | null }> {
    const user = await User.findById(userId).select("-passwordHash -refreshTokenHash");
    if (!user) {
      throw AppError.notFound("User not found", ApiErrorCode.ERR_NOT_FOUND);
    }

    const employee = await Employee.findOne({ employeeId: user.employeeId });

    return {
      user: {
        _id: user._id,
        employeeId: user.employeeId,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      employee: employee
        ? {
          _id: employee._id,
          employeeId: employee.employeeId,
          name: employee.name,
          email: employee.email,
          department: employee.department,
          designation: employee.designation,
          workType: employee.workType,
          shiftId: employee.shiftId,
          joiningDate: employee.joiningDate,
          isActive: employee.isActive,
        }
        : null,
    };
  }

  /**
   * Initiates employee self-registration by generating and securely hashing a 6-digit OTP
   */
  public async startRegistration(employeeId: string, mobileActivation = true): Promise<RegisterStartResult> {
    const normalizedId = employeeId.trim().toUpperCase();
    const employee = await Employee.findOne({ employeeId: normalizedId });

    if (!employee) {
      throw AppError.notFound(
        "Employee ID does not exist in company directory",
        ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND
      );
    }

    if (!employee.isActive) {
      throw new AppError(
        403,
        ApiErrorCode.ERR_EMPLOYEE_INACTIVE,
        "Employee profile is inactive. Please contact Human Resources."
      );
    }

    if (employee.userId) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    const existingUser = await User.findOne({ employeeId: normalizedId });
    if (existingUser) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    if (mobileActivation) {
      const pendingOtp = await RegistrationOtp.findOne({ employeeId: normalizedId, isUsed: false });
      if (pendingOtp) {
        const elapsed = Date.now() - pendingOtp.createdAt.getTime();
        if (elapsed < 60_000) {
          throw new AppError(429, ApiErrorCode.ERR_INVALID_INPUT,
            `Please wait ${Math.ceil((60_000 - elapsed) / 1000)} seconds before requesting another code.`);
        }
      }
    }

    // Generate random 6-digit OTP and store only its secure hash
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const hashedCode = await bcrypt.hash(rawOtp, 10);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    // Invalidate any previous pending OTP for this employee
    await RegistrationOtp.deleteMany({ employeeId: normalizedId });

    await RegistrationOtp.create({
      employeeId: normalizedId,
      email: employee.email,
      hashedCode,
      expiresAt,
      attempts: 0,
      isUsed: false,
    });

    const isDemoMode = !mobileActivation && env.NODE_ENV !== "production" && env.DEMO_OTP_MODE === true;
    if (!isDemoMode) {
      try {
        if (mobileActivation) await this.deliverMobileActivationOtp(employee.email, employee.name, rawOtp);
        else await this.deliverSignupOtp(employee.email, employee.name, rawOtp, env.OTP_EXPIRY_MINUTES);
      } catch (error) {
        await RegistrationOtp.deleteMany({ employeeId: normalizedId });
        logger.error("Employee registration OTP delivery failed", {
          reason: mobileActivation ? "SMTP delivery failed" : "Configured email delivery failed",
        });
        throw new AppError(503, ApiErrorCode.ERR_INTERNAL_SERVER, mobileActivation
          ? "We could not send a verification code. Check SMTP configuration and try again."
          : getSignupEmailDeliveryErrorMessage(error));
      }
    }

    return {
      employeeId: normalizedId,
      email: employee.email,
      expiresInMinutes: env.OTP_EXPIRY_MINUTES,
      resendAfterSeconds: 60,
      simulatedDemoOtp: isDemoMode ? rawOtp : undefined,
      isDemoMode,
    };
  }

  public async resendRegistrationOtp(employeeId: string): Promise<RegisterStartResult> {
    const normalizedId = employeeId.trim().toUpperCase();
    const employee = await Employee.findOne({ employeeId: normalizedId });
    if (!employee) throw AppError.notFound("Employee ID does not exist in company directory", ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND);
    if (!employee.isActive) throw new AppError(403, ApiErrorCode.ERR_EMPLOYEE_INACTIVE, "Employee profile is inactive. Please contact Human Resources.");
    if (employee.userId || await User.exists({ employeeId: normalizedId })) {
      throw new AppError(409, ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED, "Account is already registered for this Employee ID. Please log in.");
    }
    const existing = await RegistrationOtp.findOne({ employeeId: normalizedId, isUsed: false });
    if (!existing) throw AppError.badRequest("Verification code has expired or does not exist. Start registration again.", ApiErrorCode.ERR_OTP_EXPIRED);
    const elapsed = Date.now() - existing.createdAt.getTime();
    if (elapsed < 60_000) {
      throw new AppError(429, ApiErrorCode.ERR_INVALID_INPUT, `Please wait ${Math.ceil((60_000 - elapsed) / 1000)} seconds before requesting another code.`);
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    try {
      await this.deliverMobileActivationOtp(employee.email, employee.name, rawOtp);
    } catch {
      await RegistrationOtp.deleteMany({ employeeId: normalizedId });
      logger.error("Employee registration OTP resend failed", { reason: "SMTP delivery failed" });
      throw new AppError(503, ApiErrorCode.ERR_INTERNAL_SERVER, "We could not send a verification code. Check SMTP configuration and try again.");
    }
    await RegistrationOtp.updateOne({ _id: existing._id }, { $set: { hashedCode: await bcrypt.hash(rawOtp, 10), expiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60_000), attempts: 0, isUsed: false, createdAt: new Date() } });
    return { employeeId: normalizedId, email: employee.email, expiresInMinutes: env.OTP_EXPIRY_MINUTES, resendAfterSeconds: 60 };
  }

  /**
   * Verifies OTP code, registers the User account, sets password, and logs in the employee
   */
  public async verifyRegistration(
    employeeId: string,
    otp: string,
    password: string
  ): Promise<LoginResult> {
    const normalizedId = employeeId.trim().toUpperCase();
    const employee = await Employee.findOne({ employeeId: normalizedId });

    if (!employee) {
      throw AppError.notFound(
        "Employee ID does not exist in company directory",
        ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND
      );
    }

    if (!employee.isActive) {
      throw new AppError(
        403,
        ApiErrorCode.ERR_EMPLOYEE_INACTIVE,
        "Employee profile is inactive. Please contact Human Resources."
      );
    }

    if (employee.userId) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    const existingUser = await User.findOne({ employeeId: normalizedId });
    if (existingUser) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    // Find active un-used OTP
    const otpRecord = await RegistrationOtp.findOne({ employeeId: normalizedId, isUsed: false });
    if (!otpRecord) {
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_EXPIRED,
        "Verification code has expired or does not exist. Please request a new code."
      );
    }

    // Check expiration
    if (otpRecord.expiresAt.getTime() <= Date.now()) {
      await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_EXPIRED,
        "Verification code has expired. Please request a new code."
      );
    }

    // Check attempt limit
    if (otpRecord.attempts >= env.OTP_MAX_ATTEMPTS) {
      await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED,
        "Maximum verification attempts exceeded. Please request a new verification code."
      );
    }

    // Verify OTP hash
    const isMatch = await bcrypt.compare(otp.trim(), otpRecord.hashedCode);
    if (!isMatch) {
      const newAttempts = otpRecord.attempts + 1;
      if (newAttempts >= env.OTP_MAX_ATTEMPTS) {
        await RegistrationOtp.deleteOne({ _id: otpRecord._id });
        throw new AppError(
          400,
          ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED,
          "Maximum verification attempts exceeded. Please request a new verification code."
        );
      }

      await RegistrationOtp.updateOne({ _id: otpRecord._id }, { $set: { attempts: newAttempts } });
      const remaining = env.OTP_MAX_ATTEMPTS - newAttempts;
      throw new AppError(
        400,
        ApiErrorCode.ERR_INVALID_OTP,
        `Incorrect verification code. ${remaining} attempt(s) remaining.`
      );
    }

    // Invalidate OTP (single-use)
    await RegistrationOtp.deleteOne({ _id: otpRecord._id });

    // Hash password and create User account
    const passwordHash = await hashPassword(password);
    const user = await User.create({
      employeeId: normalizedId,
      email: employee.email,
      passwordHash,
      role: UserRole.EMPLOYEE,
      status: "ACTIVE",
    });

    // Link user ID to employee document
    await Employee.updateOne({ _id: employee._id }, { $set: { userId: user._id } });

    // Issue tokens
    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        refreshTokenHash,
        lastLoginAt: new Date(),
      },
    });

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      employeeId: user.employeeId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.generateAccessToken(tokenPayload);

    eventEmitterService.emitEmployeeRegistered({
      employeeId: user.employeeId,
      email: user.email,
      name: employee.name,
      role: user.role,
      status: user.status,
      registeredAt: new Date().toISOString(),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        _id: user._id.toString(),
        employeeId: user.employeeId,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      employee: {
        _id: employee._id.toString(),
        employeeId: employee.employeeId,
        name: employee.name,
        email: employee.email,
        department: employee.department,
        designation: employee.designation,
        workType: employee.workType,
        shiftId: employee.shiftId ? employee.shiftId.toString() : null,
      },
    };
  }

  /**
   * Validates OTP for Step 2 of multi-screen registration, returning a temporary verification token
   */
  public async validateOtp(
    employeeId: string,
    otp: string
  ): Promise<{ employeeId: string; verificationToken: string; expiresInMinutes: number }> {
    const normalizedId = employeeId.trim().toUpperCase();
    const employee = await Employee.findOne({ employeeId: normalizedId });

    if (!employee) {
      throw AppError.notFound(
        "Employee ID does not exist in company directory",
        ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND
      );
    }

    if (!employee.isActive) {
      throw new AppError(
        403,
        ApiErrorCode.ERR_EMPLOYEE_INACTIVE,
        "Employee profile is inactive. Please contact Human Resources."
      );
    }

    if (employee.userId) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    const existingUser = await User.findOne({ employeeId: normalizedId });
    if (existingUser) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    // Find active un-used OTP
    const otpRecord = await RegistrationOtp.findOne({ employeeId: normalizedId, isUsed: false });
    if (!otpRecord) {
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_EXPIRED,
        "Verification code has expired or does not exist. Please request a new code."
      );
    }

    // Check expiration
    if (otpRecord.expiresAt.getTime() <= Date.now()) {
      await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_EXPIRED,
        "Verification code has expired. Please request a new code."
      );
    }

    // Check attempt limit
    if (otpRecord.attempts >= env.OTP_MAX_ATTEMPTS) {
      await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw new AppError(
        400,
        ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED,
        "Maximum verification attempts exceeded. Please request a new verification code."
      );
    }

    // Verify OTP hash
    const isMatch = await bcrypt.compare(otp.trim(), otpRecord.hashedCode);
    if (!isMatch) {
      const newAttempts = otpRecord.attempts + 1;
      if (newAttempts >= env.OTP_MAX_ATTEMPTS) {
        await RegistrationOtp.deleteOne({ _id: otpRecord._id });
        throw new AppError(
          400,
          ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED,
          "Maximum verification attempts exceeded. Please request a new verification code."
        );
      }

      await RegistrationOtp.updateOne({ _id: otpRecord._id }, { $set: { attempts: newAttempts } });
      const remaining = env.OTP_MAX_ATTEMPTS - newAttempts;
      throw new AppError(
        400,
        ApiErrorCode.ERR_INVALID_OTP,
        `Incorrect verification code. ${remaining} attempt(s) remaining.`
      );
    }

    // Generate signed verification token valid for 15 minutes
    const verificationToken = jwt.sign(
      { employeeId: normalizedId, purpose: "REGISTRATION_VERIFICATION" },
      env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    return {
      employeeId: normalizedId,
      verificationToken,
      expiresInMinutes: 15,
    };
  }

  /**
   * Completes registration using the verification token from Step 2 and sets the password
   */
  public async completeRegistrationWithToken(
    employeeId: string,
    verificationToken: string,
    password: string
  ): Promise<LoginResult> {
    const normalizedId = employeeId.trim().toUpperCase();

    // Verify JWT verification token
    let payload: { employeeId: string; purpose: string };
    try {
      payload = jwt.verify(verificationToken, env.JWT_SECRET) as {
        employeeId: string;
        purpose: string;
      };
    } catch {
      throw new AppError(
        400,
        ApiErrorCode.ERR_VERIFICATION_TOKEN_EXPIRED,
        "Your verification session has expired. Please restart the registration."
      );
    }

    if (payload.purpose !== "REGISTRATION_VERIFICATION" || payload.employeeId !== normalizedId) {
      throw new AppError(
        400,
        ApiErrorCode.ERR_INVALID_INPUT,
        "Invalid verification session. Please restart registration."
      );
    }

    const employee = await Employee.findOne({ employeeId: normalizedId });
    if (!employee) {
      throw AppError.notFound(
        "Employee ID does not exist in company directory",
        ApiErrorCode.ERR_EMPLOYEE_NOT_FOUND
      );
    }

    if (!employee.isActive) {
      throw new AppError(
        403,
        ApiErrorCode.ERR_EMPLOYEE_INACTIVE,
        "Employee profile is inactive. Please contact Human Resources."
      );
    }

    const existingUser = await User.findOne({ employeeId: normalizedId });
    if (existingUser || employee.userId) {
      throw new AppError(
        409,
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED,
        "Account is already registered for this Employee ID. Please log in."
      );
    }

    // Invalidate any remaining OTPs
    await RegistrationOtp.deleteMany({ employeeId: normalizedId });

    // Hash password and create User account
    const passwordHash = await hashPassword(password);
    const user = await User.create({
      employeeId: normalizedId,
      email: employee.email,
      passwordHash,
      role: UserRole.EMPLOYEE,
      status: "ACTIVE",
    });

    // Link user ID to employee document
    await Employee.updateOne({ _id: employee._id }, { $set: { userId: user._id } });

    // Issue tokens
    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        refreshTokenHash,
        lastLoginAt: new Date(),
      },
    });

    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      employeeId: user.employeeId,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.generateAccessToken(tokenPayload);

    eventEmitterService.emitEmployeeRegistered({
      employeeId: user.employeeId,
      email: user.email,
      name: employee.name,
      role: user.role,
      status: user.status,
      registeredAt: new Date().toISOString(),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        _id: user._id.toString(),
        employeeId: user.employeeId,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      employee: {
        _id: employee._id.toString(),
        employeeId: employee.employeeId,
        name: employee.name,
        email: employee.email,
        department: employee.department,
        designation: employee.designation,
        workType: employee.workType,
        shiftId: employee.shiftId ? employee.shiftId.toString() : null,
      },
    };
  }

  /**
   * Registers a new user via corporate email and password.
   * - If an inviteToken is supplied, validates invitation and creates HR or Admin account.
   * - Without an inviteToken, starts registration for an existing, active, unlinked employee.
   */
  public async signup(params: {
    employeeId?: string;
    email?: string;
    password: string;
    name?: string;
    inviteToken?: string;
  }): Promise<{
    success: boolean;
    message: string;
    requiresEmailVerification: boolean;
    user?: {
      _id: string;
      email: string;
      employeeId: string;
      role: UserRole;
      status: string;
    };
    requiresOtpVerification?: boolean;
    employeeId?: string;
    email?: string;
    maskedEmail?: string;
    simulatedDemoOtp?: string;
    demoNotice?: string;
    expiresInMinutes?: number;
  }> {
    if (!isPasswordStrong(params.password)) {
      throw AppError.badRequest(
        "Password must be at least 8 characters and contain uppercase, lowercase, and a number or symbol.",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    if (!params.inviteToken) {
      if (!params.employeeId?.trim()) {
        throw AppError.badRequest("Employee ID is required.", ApiErrorCode.ERR_INVALID_INPUT);
      }

      const registration = await this.startRegistration(params.employeeId, false);
      return {
        success: true,
        message: registration.isDemoMode
          ? "Demo verification code generated. Enter the labeled code to complete registration."
          : "A verification code has been sent to the email address on your employee record.",
        requiresEmailVerification: false,
        requiresOtpVerification: true,
        employeeId: registration.employeeId,
        email: registration.email,
        maskedEmail: registration.email.replace(/(?<=.{2}).(?=[^@]*?@)/g, "*"),
        simulatedDemoOtp: registration.simulatedDemoOtp,
        demoNotice: registration.isDemoMode
          ? "SIMULATED OTP FOR DEMO ENVIRONMENT ONLY — NEVER RETURNED IN PRODUCTION"
          : undefined,
        expiresInMinutes: registration.expiresInMinutes,
      };
    }

    const cleanEmail = (params.email || "").trim().toLowerCase();
    const cleanName = (params.name || "").trim();
    const requestedEmployeeId = params.employeeId?.trim().toUpperCase();

    const passwordHash = await hashPassword(params.password);
    let role: UserRole = UserRole.EMPLOYEE;
    // OTP demo mode is unrelated to email verification; open signups always
    // verify their email before they can sign in.
    let status: "ACTIVE" | "PENDING_VERIFICATION" = "PENDING_VERIFICATION";
    let isEmailVerified = false;
    let department = "General";
    let designation = "Employee";
    let inviteDoc: IStaffInvitation | null = null;
    let emailVerificationTokenHash: string | null = null;
    let emailVerificationExpiresAt: Date | null = null;

    let user: IUser | null = null;
    let forceRandomEmployeeId = false;
    const session = await mongoose.startSession();

    try {
      let created = false;
      for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
        try {
          await session.withTransaction(async () => {
            const existingUser = await User.findOne({ email: cleanEmail }).session(session);
            if (existingUser) {
              throw AppError.conflict(
                "An account with this email address already exists.",
                ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
              );
            }

            const existingEmployee = await Employee.findOne({ email: cleanEmail }).session(session);
            if (existingEmployee) {
              throw AppError.conflict(
                "An employee profile with this email already exists. Please sign in or contact HR to link your account.",
                ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
              );
            }

            if (!params.inviteToken && requestedEmployeeId) {
              const duplicateUserId = await User.exists({ employeeId: requestedEmployeeId }).session(session);
              const duplicateEmployeeId = await Employee.exists({ employeeId: requestedEmployeeId }).session(session);
              if (duplicateUserId || duplicateEmployeeId) {
                throw AppError.conflict(
                  "This Employee ID is already registered. Please check the ID or contact HR.",
                  ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
                );
              }
            }

            role = UserRole.EMPLOYEE;
            status = "PENDING_VERIFICATION";
            isEmailVerified = false;
            department = "General";
            designation = "Employee";
            inviteDoc = null;

            if (params.inviteToken) {
              const inviteTokenHash = crypto
                .createHash("sha256")
                .update(params.inviteToken.trim())
                .digest("hex");

              inviteDoc = await StaffInvitation.findOne({
                tokenHash: inviteTokenHash,
                isAccepted: false,
                expiresAt: { $gt: new Date() },
              }).session(session);

              if (!inviteDoc) {
                throw AppError.badRequest(
                  "Invalid or expired staff invitation token.",
                  ApiErrorCode.ERR_TOKEN_EXPIRED
                );
              }

              if (cleanEmail !== inviteDoc.email) {
                throw AppError.badRequest(
                  "The signup email does not match the invitation email.",
                  ApiErrorCode.ERR_INVALID_INPUT
                );
              }

              if (inviteDoc.role !== UserRole.HR) {
                throw AppError.badRequest(
                  "This invitation is not valid for HR account creation.",
                  ApiErrorCode.ERR_INVALID_INPUT
                );
              }

              role = inviteDoc.role;
              status = "ACTIVE";
              isEmailVerified = true;
              if (inviteDoc.department) department = inviteDoc.department;
              if (inviteDoc.designation) designation = inviteDoc.designation;
            }

            const empPrefix = role === UserRole.HR ? "HR" : "EMP";
            const count = await User.countDocuments().session(session);
            let candidateId = !params.inviteToken && requestedEmployeeId
              ? requestedEmployeeId
              : forceRandomEmployeeId
                ? `${empPrefix}-${Math.floor(1000 + Math.random() * 9000)}`
                : `${empPrefix}-${(count + 1).toString().padStart(3, "0")}`;
            let idAttempts = 0;
            while (
              (await User.exists({ employeeId: candidateId }).session(session)) ||
              (await Employee.exists({ employeeId: candidateId }).session(session))
            ) {
              if (!params.inviteToken && requestedEmployeeId) {
                throw AppError.conflict(
                  "This Employee ID is already registered. Please check the ID or contact HR.",
                  ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
                );
              }
              candidateId = `${empPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;
              idAttempts += 1;
              if (idAttempts >= 100) {
                throw AppError.internal("Unable to allocate a unique employee ID.");
              }
            }

            emailVerificationTokenHash = null;
            emailVerificationExpiresAt = null;

            const [createdUser] = await User.create(
              [
                {
                  employeeId: candidateId,
                  email: cleanEmail,
                  passwordHash,
                  role,
                  status,
                  isEmailVerified,
                  emailVerificationTokenHash,
                  emailVerificationExpiresAt,
                },
              ],
              { session }
            );
            user = createdUser;

            await Employee.create(
              [
                {
                  employeeId: candidateId,
                  name: cleanName,
                  email: cleanEmail,
                  department,
                  designation,
                  workType: "FULL_TIME",
                  joiningDate: new Date().toISOString().split("T")[0],
                  userId: createdUser._id,
                },
              ],
              { session }
            );

            if (inviteDoc) {
              inviteDoc.isAccepted = true;
              inviteDoc.acceptedAt = new Date();
              await inviteDoc.save({ session });

              await AuditEvent.create(
                [
                  {
                    entityType: "USER",
                    entityId: createdUser._id.toString(),
                    performedBy: inviteDoc.invitedBy,
                    action: "STAFF_INVITATION_ACCEPTED",
                    reason: `Staff invitation accepted by ${cleanEmail} for role ${role}`,
                    timestamp: new Date(),
                    metadata: { role, email: cleanEmail },
                  },
                ],
                { session }
              );
            }

            await AuditEvent.create(
              [
                {
                  entityType: "USER",
                  entityId: createdUser._id.toString(),
                  performedBy: createdUser._id,
                  performedByEmployeeId: createdUser.employeeId,
                  action: "USER_SIGNUP",
                  reason: `Account registered with role ${role}`,
                  timestamp: new Date(),
                  metadata: { role, email: cleanEmail, isEmailVerified },
                },
              ],
              { session }
            );
          });
          created = true;
        } catch (error) {
          const duplicateField = getSignupDuplicateField(error);
          if (duplicateField === "employeeId" && !requestedEmployeeId && attempt < 2) {
            forceRandomEmployeeId = true;
            continue;
          }
          if (duplicateField) throw getSignupDuplicateError(duplicateField);
          throw error;
        }
      }
    } finally {
      await session.endSession();
    }

    // TypeScript cannot see assignments made inside the transaction callback.
    const savedUser = user as IUser | null;
    if (!savedUser) {
      throw AppError.internal("The account could not be confirmed as saved.");
    }

    let signupOtp: string | undefined;
    if (!isEmailVerified) {
      signupOtp = crypto.randomInt(100000, 1000000).toString();
      const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await RegistrationOtp.deleteMany({ employeeId: savedUser.employeeId });
      await RegistrationOtp.create({
        employeeId: savedUser.employeeId,
        email: cleanEmail,
        hashedCode: await bcrypt.hash(signupOtp, 10),
        expiresAt: otpExpiresAt,
        attempts: 0,
        isUsed: false,
      });

      try {
        await this.deliverSignupOtp(cleanEmail, cleanName, signupOtp);
      } catch (error) {
        await RegistrationOtp.deleteMany({ employeeId: savedUser.employeeId });
        await Employee.deleteOne({ employeeId: savedUser.employeeId });
        await User.deleteOne({ _id: savedUser._id });
        await AuditEvent.deleteMany({ entityId: savedUser._id.toString(), action: "USER_SIGNUP" });
        logger.error("Signup OTP email delivery failed", {
          reason: error instanceof Error ? error.message : "Unknown mail delivery failure",
        });
        throw new AppError(
          503,
          ApiErrorCode.ERR_INTERNAL_SERVER,
          getSignupEmailDeliveryErrorMessage(error)
        );
      }
    }

    const responsePayload: {
      success: boolean;
      message: string;
      requiresEmailVerification: boolean;
      user: {
        _id: string;
        email: string;
        employeeId: string;
        role: UserRole;
        status: string;
      };
      requiresOtpVerification: boolean;
      employeeId: string;
    } = {
      success: true,
      message: isEmailVerified
        ? "Account created and activated successfully! You may now sign in."
        : "A verification code has been sent to your email address.",
      requiresEmailVerification: !isEmailVerified,
      requiresOtpVerification: !isEmailVerified,
      employeeId: savedUser.employeeId,
      user: {
        _id: savedUser._id.toString(),
        email: savedUser.email,
        employeeId: savedUser.employeeId,
        role: savedUser.role,
        status: savedUser.status,
      },
    };

    return responsePayload;
  }

  public async verifySignupOtp(email: string, otp: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      throw AppError.badRequest("Invalid email or verification code.", ApiErrorCode.ERR_INVALID_OTP);
    }
    if (user.isEmailVerified || user.status === "ACTIVE") {
      throw AppError.conflict("This account has already been verified.", ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED);
    }

    const otpRecord = await RegistrationOtp.findOne({ employeeId: user.employeeId, email: cleanEmail });
    if (!otpRecord || otpRecord.isUsed || otpRecord.expiresAt.getTime() <= Date.now()) {
      if (otpRecord) await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw AppError.badRequest("Verification code expired. Request a new code.", ApiErrorCode.ERR_OTP_EXPIRED);
    }
    if (otpRecord.attempts >= env.OTP_MAX_ATTEMPTS) {
      await RegistrationOtp.deleteOne({ _id: otpRecord._id });
      throw AppError.badRequest("Too many attempts. Request a new verification code.", ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED);
    }

    const matches = await bcrypt.compare(otp.trim(), otpRecord.hashedCode);
    if (!matches) {
      const updatedOtp = await RegistrationOtp.findOneAndUpdate(
        {
          _id: otpRecord._id,
          attempts: otpRecord.attempts,
          isUsed: false,
          expiresAt: { $gt: new Date() },
        },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      if (!updatedOtp) {
        throw AppError.badRequest(
          "Verification code changed or expired. Request a new code.",
          ApiErrorCode.ERR_INVALID_OTP
        );
      }
      if (updatedOtp.attempts >= env.OTP_MAX_ATTEMPTS) {
        await RegistrationOtp.deleteOne({ _id: otpRecord._id });
        throw AppError.badRequest("Too many attempts. Request a new verification code.", ApiErrorCode.ERR_OTP_ATTEMPTS_EXCEEDED);
      }
      throw AppError.badRequest(`Incorrect code. ${env.OTP_MAX_ATTEMPTS - updatedOtp.attempts} attempt(s) remaining.`, ApiErrorCode.ERR_INVALID_OTP);
    }

    const consumed = await RegistrationOtp.deleteOne({ _id: otpRecord._id });
    if (consumed.deletedCount !== 1) {
      throw AppError.badRequest("This verification code has already been used.", ApiErrorCode.ERR_INVALID_OTP);
    }
    user.isEmailVerified = true;
    user.status = "ACTIVE";
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();
    await AuditEvent.create({
      entityType: "AUTH",
      entityId: user._id.toString(),
      performedBy: user._id,
      performedByEmployeeId: user.employeeId,
      action: "EMAIL_OTP_VERIFIED",
      timestamp: new Date(),
      metadata: { email: cleanEmail },
    });

    return { success: true, message: "Email verified successfully. You may now sign in." };
  }

  public async resendSignupOtp(email: string): Promise<{ success: boolean; message: string; cooldownSeconds: number }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user || user.isEmailVerified || user.status !== "PENDING_VERIFICATION") {
      throw AppError.badRequest("No pending signup verification was found for this email.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const existingOtp = await RegistrationOtp.findOne({ employeeId: user.employeeId, email: cleanEmail });
    const cooldownMs = 60 * 1000;
    if (existingOtp && Date.now() - existingOtp.createdAt.getTime() < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (Date.now() - existingOtp.createdAt.getTime())) / 1000);
      throw new AppError(429, ApiErrorCode.ERR_INVALID_INPUT, `Please wait ${remaining} seconds before requesting another code.`);
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    await RegistrationOtp.deleteMany({ employeeId: user.employeeId });
    await RegistrationOtp.create({
      employeeId: user.employeeId,
      email: cleanEmail,
      hashedCode: await bcrypt.hash(otp, 10),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
      isUsed: false,
    });

    try {
      const employee = await Employee.findOne({ employeeId: user.employeeId });
      await this.deliverSignupOtp(cleanEmail, employee?.name || user.employeeId, otp);
    } catch (error) {
      logger.error("Signup OTP resend failed", {
        reason: error instanceof Error ? error.message : "Unknown mail delivery failure",
      });
      throw new AppError(
        503,
        ApiErrorCode.ERR_INTERNAL_SERVER,
        getSignupEmailDeliveryErrorMessage(error)
      );
    }

    return { success: true, message: "A new verification code has been sent.", cooldownSeconds: 60 };
  }

  /**
   * Verifies an email address using single-use verification token
   */
  public async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    if (!token) {
      throw AppError.badRequest("Verification token is required.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const user = await User.findOne({ emailVerificationTokenHash: tokenHash });

    if (!user) {
      throw AppError.badRequest("Invalid verification token.", ApiErrorCode.ERR_INVALID_TOKEN);
    }

    if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt.getTime() <= Date.now()) {
      throw AppError.badRequest(
        "Verification token has expired.",
        ApiErrorCode.ERR_TOKEN_EXPIRED
      );
    }

    user.isEmailVerified = true;
    user.status = "ACTIVE";
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    await AuditEvent.create({
      entityType: "AUTH",
      entityId: user._id.toString(),
      performedBy: user._id,
      performedByEmployeeId: user.employeeId,
      action: "EMAIL_VERIFIED",
      timestamp: new Date(),
      metadata: { email: user.email },
    });

    return {
      success: true,
      message: "Email verified successfully! You may now sign in.",
    };
  }

  /**
   * Resends verification link with generic response
   */
  public async resendVerification(email: string): Promise<{ success: boolean; message: string; simulatedToken?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    let rawToken: string | undefined;

    if (user && !user.isEmailVerified) {
      rawToken = crypto.randomBytes(32).toString("hex");
      user.emailVerificationTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await user.save();

      const mailAdapter = getMailAdapter();
      const appUrl = env.CORS_ORIGIN.split(",")[0] || "http://localhost:3000";
      const verifyUrl = `${appUrl}/verify-email?token=${rawToken}`;

      await mailAdapter.sendMail({
        to: cleanEmail,
        subject: "Verify Your VorldX Account",
        html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        text: `Please verify your email address: ${verifyUrl}`,
        meta: {
          type: "EMAIL_VERIFICATION",
          token: rawToken,
          actionUrl: verifyUrl,
        },
      });
    }

    const res: { success: boolean; message: string; simulatedToken?: string } = {
      success: true,
      message: "If an unverified account exists with this email address, a verification link has been dispatched.",
    };

    if (env.NODE_ENV !== "production" && rawToken) {
      res.simulatedToken = rawToken;
    }

    return res;
  }

  /**
   * Generates single-use password reset link with generic anti-enumeration response
   */
  public async forgotPassword(email: string): Promise<{ success: boolean; message: string; simulatedToken?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail, status: { $ne: "INACTIVE" } });

    let rawToken: string | undefined;

    if (user) {
      rawToken = crypto.randomBytes(32).toString("hex");
      user.passwordResetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save();

      const mailAdapter = getMailAdapter();
      const appUrl = env.CORS_ORIGIN.split(",")[0] || "http://localhost:3000";
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

      await mailAdapter.sendMail({
        to: cleanEmail,
        subject: "Password Reset Request - VorldX",
        html: `<p>A password reset was requested for your VorldX account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link is valid for 1 hour. If you did not make this request, you can safely ignore this email.</p>`,
        text: `A password reset was requested for your VorldX account.\n\nReset your password: ${resetUrl}\n\nThis link is valid for 1 hour.`,
        meta: {
          type: "PASSWORD_RESET",
          token: rawToken,
          actionUrl: resetUrl,
        },
      });

      await AuditEvent.create({
        entityType: "AUTH",
        entityId: user._id.toString(),
        action: "PASSWORD_RESET_REQUESTED",
        timestamp: new Date(),
        metadata: { email: cleanEmail },
      });
    }

    const res: { success: boolean; message: string; simulatedToken?: string } = {
      success: true,
      message: "If that email address is registered, a password reset link has been dispatched.",
    };

    if (env.NODE_ENV !== "production" && rawToken) {
      res.simulatedToken = rawToken;
    }

    return res;
  }

  /**
   * Resets password using single-use hashed token with password strength check
   */
  public async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!token) {
      throw AppError.badRequest("Reset token is required.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    if (!isPasswordStrong(newPassword)) {
      throw AppError.badRequest(
        "Password must be at least 8 characters and contain uppercase, lowercase, and a number or symbol.",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const user = await User.findOne({ passwordResetTokenHash: tokenHash });

    if (!user) {
      throw AppError.badRequest("Invalid password reset token.", ApiErrorCode.ERR_INVALID_TOKEN);
    }

    if (user.passwordResetExpiresAt && user.passwordResetExpiresAt.getTime() <= Date.now()) {
      throw AppError.badRequest(
        "Invalid or expired password reset link.",
        ApiErrorCode.ERR_TOKEN_EXPIRED
      );
    }

    const passwordHash = await hashPassword(newPassword);

    user.passwordHash = passwordHash;
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    user.refreshTokenHash = null; // Invalidate all existing sessions
    await user.save();

    await AuditEvent.create({
      entityType: "AUTH",
      entityId: user._id.toString(),
      performedBy: user._id,
      performedByEmployeeId: user.employeeId,
      action: "PASSWORD_RESET_COMPLETED",
      timestamp: new Date(),
      metadata: { email: user.email },
    });

    return {
      success: true,
      message: "Password updated successfully. You may now sign in with your new password.",
    };
  }

  /**
   * Generates a single-use staff invitation link (Admin only)
   */
  public async createStaffInvite(
    adminUserId: string,
    params: {
      email: string;
      role: UserRole;
      name?: string;
      department?: string;
      designation?: string;
    },
    allowExistingInvitation = false
  ): Promise<{
    success: boolean;
    message: string;
    email: string;
    role: UserRole;
    expiresInHours: number;
    inviteToken?: string;
  }> {
    const admin = await User.findById(adminUserId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Only system administrators can generate staff invitations.",
        ApiErrorCode.ERR_FORBIDDEN
      );
    }

    if (params.role !== UserRole.HR) {
      throw AppError.badRequest(
        "Staff invitations may only create HR accounts.",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const cleanEmail = params.email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw AppError.conflict(
        "A user account with this email address already exists.",
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
      );
    }

    const existingInvitation = await StaffInvitation.findOne({ email: cleanEmail, role: UserRole.HR, isAccepted: false });
    if (existingInvitation && !allowExistingInvitation) {
      throw AppError.conflict(
        "An HR invitation already exists for this email. Use Resend from the HR list to send a fresh link.",
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    // Fail fast on missing SMTP configuration before writing/replacing an invite.
    const mailAdapter = getSmtpMailAdapter();

    const pendingInvitation = await StaffInvitation.findOneAndUpdate(
      { email: cleanEmail },
      {
        email: cleanEmail,
        role: params.role,
        tokenHash,
        invitedBy: admin._id,
        expiresAt,
        isAccepted: false,
        name: params.name?.trim() || null,
        department: params.department?.trim() || null,
        designation: params.designation?.trim() || null,
      },
      { upsert: true, new: true }
    );

    // HR invitation and resend use Brevo SMTP through Nodemailer explicitly,
    // even when the Brevo HTTP API is configured for OTP and other mail flows.
    const appUrl = env.CORS_ORIGIN.split(",")[0] || "http://localhost:3000";
    const inviteUrl = `${appUrl}/signup?invite=${rawToken}`;

    try {
      await mailAdapter.sendMail({
        to: cleanEmail,
        subject: `Invitation to join VorldX as ${params.role}`,
        html: `<p>You have been invited by ${admin.email} to join VorldX Workforce Suite as <strong>${params.role}</strong>.</p><p><a href="${inviteUrl}">Click here to accept your invitation and create your account</a></p><p>This invitation link expires in 48 hours.</p>`,
        text: `You have been invited to join VorldX Workforce Suite as ${params.role}.\n\nAccept your invitation: ${inviteUrl}\n\nThis invitation link expires in 48 hours.`,
        meta: {
          type: "STAFF_INVITATION",
          token: rawToken,
          actionUrl: inviteUrl,
          recipientName: params.name,
          role: params.role,
        },
      });
    } catch (error: unknown) {
      const smtpError = error as { code?: unknown; responseCode?: unknown };
      const isSmtpAuthFailure = smtpError.code === "EAUTH" || smtpError.responseCode === 535;
      try {
        if (existingInvitation) {
          await StaffInvitation.updateOne(
            { _id: existingInvitation._id, tokenHash },
            {
              $set: {
                tokenHash: existingInvitation.tokenHash,
                invitedBy: existingInvitation.invitedBy,
                expiresAt: existingInvitation.expiresAt,
                isAccepted: existingInvitation.isAccepted,
                name: existingInvitation.name,
                department: existingInvitation.department,
                designation: existingInvitation.designation,
              },
            }
          );
        } else if (pendingInvitation) {
          await StaffInvitation.deleteOne({ _id: pendingInvitation._id, tokenHash });
        }
      } catch (restoreError: unknown) {
        const rollbackError = restoreError as { code?: unknown };
        logger.error("Could not restore the prior HR invitation after SMTP failure", {
          code: typeof rollbackError.code === "string" ? rollbackError.code : undefined,
        });
      }
      logger.error("HR invitation SMTP delivery failed", {
        code: typeof smtpError.code === "string" ? smtpError.code : undefined,
        responseCode: typeof smtpError.responseCode === "number" ? smtpError.responseCode : undefined,
      });
      throw new AppError(
        503,
        ApiErrorCode.ERR_INTERNAL_SERVER,
        isSmtpAuthFailure
          ? "Brevo rejected SMTP authentication. Check SMTP_USER and SMTP_PASS; use the Brevo SMTP login and SMTP key, not the API key, then retry."
          : "The HR invitation email service is unavailable. Check the SMTP configuration and retry."
      );
    }

    await AuditEvent.create({
      entityType: "USER",
      entityId: admin._id.toString(),
      performedBy: admin._id,
      performedByEmployeeId: admin.employeeId,
      action: "STAFF_INVITATION_CREATED",
      reason: `Invited ${cleanEmail} for role ${params.role}`,
      timestamp: new Date(),
      metadata: { targetEmail: cleanEmail, role: params.role },
    });

    const res: {
      success: boolean;
      message: string;
      email: string;
      role: UserRole;
      expiresInHours: number;
      inviteToken?: string;
      invitation?: { email: string; role: UserRole };
    } = {
      success: true,
      message: `Invitation successfully sent to ${cleanEmail}.`,
      email: cleanEmail,
      role: params.role,
      expiresInHours: 48,
      invitation: { email: cleanEmail, role: params.role },
    };

    if (env.NODE_ENV !== "production") {
      res.inviteToken = rawToken;
    }

    return res;
  }

  public async listHrManagementRecords(): Promise<Array<{
    id: string;
    email: string;
    name: string;
    role: UserRole;
    accountStatus: string;
    invitationStatus: "Pending" | "Accepted" | "Expired";
    createdAt: Date;
    department: string;
    designation: string;
  }>> {
    const [hrUsers, invitations] = await Promise.all([
      User.find({ role: UserRole.HR }).sort({ createdAt: -1 }).lean(),
      StaffInvitation.find({ role: UserRole.HR }).sort({ createdAt: -1 }).lean(),
    ]);
    const employeeIds = hrUsers.map((user) => user.employeeId);
    const profiles = await Employee.find({ employeeId: { $in: employeeIds } })
      .select("employeeId name department designation")
      .lean();
    const profileByEmployeeId = new Map(profiles.map((profile) => [profile.employeeId, profile]));
    const userByEmail = new Map(hrUsers.map((user) => [user.email.toLowerCase(), user]));
    const records = new Map<string, {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      accountStatus: string;
      invitationStatus: "Pending" | "Accepted" | "Expired";
      createdAt: Date;
      department: string;
      designation: string;
    }>();

    for (const user of hrUsers) {
      records.set(user.email.toLowerCase(), {
        id: user._id.toString(),
        email: user.email,
        name: profileByEmployeeId.get(user.employeeId)?.name || user.employeeId,
        role: UserRole.HR,
        accountStatus: user.status,
        invitationStatus: "Accepted",
        createdAt: user.createdAt,
        department: profileByEmployeeId.get(user.employeeId)?.department || "",
        designation: profileByEmployeeId.get(user.employeeId)?.designation || "",
      });
    }

    for (const invite of invitations) {
      const email = invite.email.toLowerCase();
      if (userByEmail.has(email)) continue;
      records.set(email, {
        id: invite._id.toString(),
        email: invite.email,
        name: invite.name || invite.email,
        role: UserRole.HR,
        accountStatus: "NOT_CREATED",
        invitationStatus: invite.expiresAt.getTime() <= Date.now() ? "Expired" : "Pending",
        createdAt: invite.createdAt,
        department: invite.department || "",
        designation: invite.designation || "",
      });
    }

    return [...records.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async resendHrInvitation(adminUserId: string, invitationId: string) {
    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
      throw AppError.badRequest("Invalid HR invitation identifier.", ApiErrorCode.ERR_INVALID_INPUT);
    }
    const invitation = await StaffInvitation.findOne({
      _id: invitationId,
      role: UserRole.HR,
      isAccepted: false,
    }).lean();
    if (!invitation) {
      throw AppError.notFound("Pending HR invitation was not found.", ApiErrorCode.ERR_NOT_FOUND);
    }
    return this.createStaffInvite(adminUserId, {
      email: invitation.email,
      role: UserRole.HR,
      name: invitation.name || undefined,
      department: invitation.department || undefined,
      designation: invitation.designation || undefined,
    }, true);
  }

  public async setHrAccountStatus(
    adminUserId: string,
    hrUserId: string,
    status: "ACTIVE" | "INACTIVE"
  ): Promise<{ id: string; status: string }> {
    const admin = await User.findById(adminUserId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw AppError.forbidden("Only system administrators can manage HR accounts.", ApiErrorCode.ERR_FORBIDDEN);
    }
    if (!mongoose.Types.ObjectId.isValid(hrUserId)) {
      throw AppError.badRequest("Invalid HR account identifier.", ApiErrorCode.ERR_INVALID_INPUT);
    }
    const hrUser = await User.findOneAndUpdate(
      { _id: hrUserId, role: UserRole.HR },
      { $set: { status, ...(status === "INACTIVE" ? { refreshTokenHash: null } : {}) } },
      { new: true }
    );
    if (!hrUser) {
      throw AppError.notFound("HR account was not found.", ApiErrorCode.ERR_NOT_FOUND);
    }
    await reauthorizeUserSockets([hrUser._id.toString()]);
    if (status === "INACTIVE") {
      await StaffSession.updateMany({ user: hrUser._id, isActive: true }, { $set: { isActive: false } });
    }
    await AuditEvent.create({
      entityType: "USER",
      entityId: hrUser._id.toString(),
      performedBy: admin._id,
      performedByEmployeeId: admin.employeeId,
      action: status === "INACTIVE" ? "HR_ACCOUNT_DEACTIVATED" : "HR_ACCOUNT_REACTIVATED",
      timestamp: new Date(),
      metadata: { targetUserId: hrUser._id.toString(), status },
    });
    return { id: hrUser._id.toString(), status: hrUser.status };
  }

  public async updateHrManagementRecord(
    adminUserId: string,
    recordId: string,
    details: { name: string; department: string; designation: string }
  ): Promise<{ id: string }> {
    const admin = await User.findById(adminUserId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw AppError.forbidden("Only system administrators can manage HR accounts.", ApiErrorCode.ERR_FORBIDDEN);
    }
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      throw AppError.badRequest("Invalid HR record identifier.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const invitation = await StaffInvitation.findOne({ _id: recordId, role: UserRole.HR, isAccepted: false });
    if (invitation) {
      invitation.name = details.name.trim();
      invitation.department = details.department.trim();
      invitation.designation = details.designation.trim();
      await invitation.save();
      return { id: invitation._id.toString() };
    }

    const hrUser = await User.findOne({ _id: recordId, role: UserRole.HR });
    if (!hrUser) throw AppError.notFound("HR account or invitation was not found.", ApiErrorCode.ERR_NOT_FOUND);
    const profile = await Employee.findOne({ employeeId: hrUser.employeeId });
    if (!profile) throw AppError.notFound("HR employee profile was not found.", ApiErrorCode.ERR_NOT_FOUND);
    profile.name = details.name.trim();
    profile.department = details.department.trim();
    profile.designation = details.designation.trim();
    await profile.save();
    return { id: hrUser._id.toString() };
  }

  public async deleteHrManagementRecord(adminUserId: string, recordId: string): Promise<{ id: string }> {
    const admin = await User.findById(adminUserId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw AppError.forbidden("Only system administrators can manage HR accounts.", ApiErrorCode.ERR_FORBIDDEN);
    }
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      throw AppError.badRequest("Invalid HR record identifier.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const invitation = await StaffInvitation.findOneAndDelete({ _id: recordId, role: UserRole.HR, isAccepted: false });
    if (invitation) return { id: invitation._id.toString() };

    const hrUser = await User.findOne({ _id: recordId, role: UserRole.HR });
    if (!hrUser) throw AppError.notFound("HR account or invitation was not found.", ApiErrorCode.ERR_NOT_FOUND);

    await StaffSession.updateMany({ user: hrUser._id, isActive: true }, { $set: { isActive: false } });
    await Employee.updateOne(
      { employeeId: hrUser.employeeId, userId: hrUser._id },
      { $set: { userId: null, isActive: false } }
    );
    await StaffInvitation.deleteMany({ email: hrUser.email, role: UserRole.HR });
    await User.deleteOne({ _id: hrUser._id, role: UserRole.HR });
    await AuditEvent.create({
      entityType: "USER",
      entityId: hrUser._id.toString(),
      performedBy: admin._id,
      performedByEmployeeId: admin.employeeId,
      action: "HR_ACCOUNT_DELETED",
      timestamp: new Date(),
      metadata: { targetEmail: hrUser.email, employeeId: hrUser.employeeId },
    });
    return { id: hrUser._id.toString() };
  }

  /**
   * Verifies validity of an invitation token for the signup UI
   */
  public async verifyInvite(token: string): Promise<{
    success: boolean;
    valid: boolean;
    email: string;
    role: UserRole;
    name?: string | null;
    department?: string | null;
    designation?: string | null;
    data?: {
      email: string;
      role: UserRole;
      name?: string | null;
      department?: string | null;
      designation?: string | null;
    };
  }> {
    if (!token) {
      throw AppError.badRequest("Invitation token is required.", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const invite = await StaffInvitation.findOne({
      tokenHash,
      isAccepted: false,
      expiresAt: { $gt: new Date() },
    });

    if (!invite) {
      throw AppError.badRequest(
        "Invalid or expired staff invitation token.",
        ApiErrorCode.ERR_TOKEN_EXPIRED
      );
    }

    return {
      success: true,
      valid: true,
      email: invite.email,
      role: invite.role,
      name: invite.name,
      department: invite.department,
      designation: invite.designation,
      data: {
        email: invite.email,
        role: invite.role,
        name: invite.name,
        department: invite.department,
        designation: invite.designation,
      },
    };
  }
}

export const authService = new AuthService();
