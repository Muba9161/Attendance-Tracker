import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { User, IUser, hashPassword } from "../models/User";
import { Employee, IEmployee } from "../models/Employee";
import { RegistrationOtp } from "../models/RegistrationOtp";
import { StaffInvitation } from "../models/StaffInvitation";
import { StaffSession } from "../models/StaffSession";
import { AuditEvent } from "../models/AuditEvent";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { eventEmitterService } from "./eventEmitter.service";
import { getMailAdapter } from "./mail";
import { ApiErrorCode, UserRole, isPasswordStrong } from "@vorldx/shared";

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
  simulatedDemoOtp?: string;
  isDemoMode: boolean;
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

    // Check account lockout status
    if (user.lockoutUntil && user.lockoutUntil.getTime() > Date.now()) {
      const remainingMinutes = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / (60 * 1000));
      throw new AppError(
        423,
        ApiErrorCode.ERR_ACCOUNT_LOCKED,
        `Account is temporarily locked due to repeated failed login attempts. Please try again after ${remainingMinutes} minute(s).`
      );
    }

    // Verify password with bcrypt
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
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
          `Account is temporarily locked due to ${env.MAX_LOGIN_ATTEMPTS} consecutive failed login attempts. Please try again after ${env.LOCKOUT_MINUTES} minutes.`
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
  public async startRegistration(employeeId: string): Promise<RegisterStartResult> {
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

    const isDemoMode = env.NODE_ENV !== "production" && env.DEMO_OTP_MODE === true;

    return {
      employeeId: normalizedId,
      email: employee.email,
      expiresInMinutes: env.OTP_EXPIRY_MINUTES,
      simulatedDemoOtp: isDemoMode ? rawOtp : undefined,
      isDemoMode,
    };
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
   * - If no inviteToken, registers a standard EMPLOYEE account requiring email verification.
   */
  public async signup(params: {
    email: string;
    password: string;
    name: string;
    inviteToken?: string;
  }): Promise<{
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
    simulatedToken?: string;
  }> {
    const cleanEmail = params.email.trim().toLowerCase();

    if (!isPasswordStrong(params.password)) {
      throw AppError.badRequest(
        "Password must be at least 8 characters and contain uppercase, lowercase, and a number or symbol.",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw AppError.conflict(
        "An account with this email address already exists.",
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
      );
    }

    let role: UserRole = UserRole.EMPLOYEE;
    let status: "ACTIVE" | "PENDING_VERIFICATION" = "PENDING_VERIFICATION";
    let isEmailVerified = false;
    let department = "General";
    let designation = "Employee";
    let inviteDoc = null;
    let verificationToken: string | undefined;

    if (params.inviteToken) {
      const inviteTokenHash = crypto
        .createHash("sha256")
        .update(params.inviteToken.trim())
        .digest("hex");

      inviteDoc = await StaffInvitation.findOne({
        tokenHash: inviteTokenHash,
        isAccepted: false,
        expiresAt: { $gt: new Date() },
      });

      if (!inviteDoc) {
        throw AppError.badRequest(
          "Invalid or expired staff invitation token.",
          ApiErrorCode.ERR_TOKEN_EXPIRED
        );
      }

      // Invitation grants specific authorized role and auto-activates email
      role = inviteDoc.role;
      status = "ACTIVE";
      isEmailVerified = true;
      if (inviteDoc.department) department = inviteDoc.department;
      if (inviteDoc.designation) designation = inviteDoc.designation;
    }

    // Determine unique Employee ID
    const count = await User.countDocuments();
    const empPrefix = role === UserRole.ADMIN ? "ADM" : role === UserRole.HR ? "HR" : "EMP";
    let candidateId = `${empPrefix}-${(count + 1).toString().padStart(3, "0")}`;
    while (await User.exists({ employeeId: candidateId })) {
      candidateId = `${empPrefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const passwordHash = await hashPassword(params.password);

    let emailVerificationTokenHash: string | null = null;
    let emailVerificationExpiresAt: Date | null = null;

    if (!isEmailVerified) {
      verificationToken = crypto.randomBytes(32).toString("hex");
      emailVerificationTokenHash = crypto
        .createHash("sha256")
        .update(verificationToken)
        .digest("hex");
      emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }

    const user = await User.create({
      employeeId: candidateId,
      email: cleanEmail,
      passwordHash,
      role,
      status,
      isEmailVerified,
      emailVerificationTokenHash,
      emailVerificationExpiresAt,
    });

    await Employee.create({
      employeeId: candidateId,
      name: params.name.trim(),
      email: cleanEmail,
      department,
      designation,
      workType: "FULL_TIME",
      joiningDate: new Date().toISOString().split("T")[0],
      userId: user._id,
    });

    if (inviteDoc) {
      inviteDoc.isAccepted = true;
      inviteDoc.acceptedAt = new Date();
      await inviteDoc.save();

      await AuditEvent.create({
        entityType: "USER",
        entityId: user._id.toString(),
        performedBy: inviteDoc.invitedBy,
        action: "STAFF_INVITATION_ACCEPTED",
        reason: `Staff invitation accepted by ${cleanEmail} for role ${role}`,
        timestamp: new Date(),
        metadata: { role, email: cleanEmail },
      });
    }

    await AuditEvent.create({
      entityType: "USER",
      entityId: user._id.toString(),
      performedBy: user._id,
      performedByEmployeeId: user.employeeId,
      action: "USER_SIGNUP",
      reason: `Account registered with role ${role}`,
      timestamp: new Date(),
      metadata: { role, email: cleanEmail, isEmailVerified },
    });

    // Send email via mail adapter
    const mailAdapter = getMailAdapter();
    const appUrl = env.CORS_ORIGIN.split(",")[0] || "http://localhost:3000";

    if (!isEmailVerified && verificationToken) {
      const verifyUrl = `${appUrl}/verify-email?token=${verificationToken}`;
      await mailAdapter.sendMail({
        to: cleanEmail,
        subject: "Verify Your VorldX Account",
        html: `<p>Welcome to VorldX, ${params.name.trim()}!</p><p>Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
        text: `Welcome to VorldX, ${params.name.trim()}!\n\nPlease verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
        meta: {
          type: "EMAIL_VERIFICATION",
          token: verificationToken,
          actionUrl: verifyUrl,
          recipientName: params.name,
          role,
        },
      });
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
      simulatedToken?: string;
    } = {
      success: true,
      message: isEmailVerified
        ? "Account created and activated successfully! You may now sign in."
        : "Account created! A verification link has been sent to your email.",
      requiresEmailVerification: !isEmailVerified,
      user: {
        _id: user._id.toString(),
        email: user.email,
        employeeId: user.employeeId,
        role: user.role,
        status: user.status,
      },
    };

    if (env.NODE_ENV !== "production" && verificationToken) {
      responsePayload.simulatedToken = verificationToken;
    }

    return responsePayload;
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
    }
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

    const cleanEmail = params.email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw AppError.conflict(
        "A user account with this email address already exists.",
        ApiErrorCode.ERR_ACCOUNT_ALREADY_REGISTERED
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await StaffInvitation.findOneAndUpdate(
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

    const mailAdapter = getMailAdapter();
    const appUrl = env.CORS_ORIGIN.split(",")[0] || "http://localhost:3000";
    const inviteUrl = `${appUrl}/signup?invite=${rawToken}`;

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
