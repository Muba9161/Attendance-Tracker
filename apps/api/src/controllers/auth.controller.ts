import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { ApiErrorCode } from "@vorldx/shared";

/**
 * Controller handling user authentication, session refresh, and profile retrieval
 */
export class AuthController {
  public registerStart = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId } = req.body;
    if (!employeeId) {
      throw AppError.badRequest("Employee ID is required", ApiErrorCode.ERR_INVALID_INPUT);
    }

    const result = await authService.startRegistration(employeeId);

    const responsePayload: Record<string, unknown> = {
      success: true,
      message: result.isDemoMode
        ? "Verification code generated. Complete registration using the simulated OTP."
        : "Verification code sent to registered employee email.",
      employeeId: result.employeeId,
      email: result.email,
      expiresInMinutes: result.expiresInMinutes,
      data: {
        employeeId: result.employeeId,
        email: result.email,
        maskedEmail: result.email.replace(/(?<=.{2}).(?=[^@]*?@)/g, "*"),
        simulatedOtp: result.simulatedDemoOtp || "",
        expiresInMinutes: result.expiresInMinutes,
      },
    };

    if (result.isDemoMode && result.simulatedDemoOtp) {
      responsePayload.simulatedDemoOtp = result.simulatedDemoOtp;
      responsePayload.demoNotice =
        "SIMULATED OTP FOR DEMO ENVIRONMENT ONLY — NEVER RETURNED IN PRODUCTION";
    }

    res.status(200).json(responsePayload);
  });

  public registerVerify = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, otp, password } = req.body;
    if (!employeeId || !otp) {
      throw AppError.badRequest(
        "Employee ID and OTP are required",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    // If password is not provided, this is Step 2 of multi-screen registration (validating OTP only)
    if (!password) {
      const result = await authService.validateOtp(employeeId, otp);
      res.status(200).json({
        success: true,
        message: "Verification code validated successfully.",
        employeeId: result.employeeId,
        verificationToken: result.verificationToken,
        data: {
          employeeId: result.employeeId,
          verificationToken: result.verificationToken,
          expiresInMinutes: result.expiresInMinutes,
        },
      });
      return;
    }

    const result = await authService.verifyRegistration(employeeId, otp, password);

    // Set secure HTTP-only refresh token cookie for browser clients
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(201).json({
      success: true,
      message: "Account registered and verified successfully.",
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      employee: result.employee,
      data: {
        user: {
          ...result.user,
          name: result.employee?.name || result.user.employeeId,
          department: result.employee?.department,
          designation: result.employee?.designation,
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  });

  public registerComplete = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, verificationToken, password } = req.body;
    if (!employeeId || !verificationToken || !password) {
      throw AppError.badRequest(
        "Employee ID, verification token, and password are required",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const result = await authService.completeRegistrationWithToken(
      employeeId,
      verificationToken,
      password
    );

    // Set secure HTTP-only refresh token cookie for browser clients
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(201).json({
      success: true,
      message: "Account registered and activated successfully.",
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      employee: result.employee,
      data: {
        user: {
          ...result.user,
          name: result.employee?.name || result.user.employeeId,
          department: result.employee?.department,
          designation: result.employee?.designation,
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  });

  public login = asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, email, identifier, password } = req.body;
    const loginIdentifier = identifier || employeeId || email;

    if (!loginIdentifier || !password) {
      throw AppError.badRequest(
        "Employee ID or email and password are required",
        ApiErrorCode.ERR_INVALID_INPUT
      );
    }

    const meta = {
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1",
      userAgent: (req.headers["user-agent"] as string) || "unknown",
    };

    const result = await authService.login(loginIdentifier, password, meta);

    // Set secure HTTP-only refresh token cookie for browser clients
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      employee: result.employee,
      data: {
        user: {
          ...result.user,
          name: result.employee?.name || result.user.employeeId,
          department: result.employee?.department,
          designation: result.employee?.designation,
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  });

  public refresh = asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      throw AppError.unauthorized("Refresh token is required", ApiErrorCode.ERR_UNAUTHORIZED);
    }

    const result = await authService.refreshToken(token);

    // Rotate refresh token cookie
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(200).json({
      success: true,
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
    });
  });

  public logout = asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    const userId = req.user?.userId;

    await authService.logout(userId, token);

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  });

  public getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.userId) {
      throw AppError.unauthorized("Authentication required", ApiErrorCode.ERR_UNAUTHORIZED);
    }

    const profile = await authService.getCurrentUser(req.user.userId);

    res.status(200).json({
      success: true,
      data: {
        ...profile,
        user: {
          ...profile.user,
          name: profile.employee?.name || profile.user.employeeId,
          department: profile.employee?.department,
          designation: profile.employee?.designation,
        },
      },
      user: profile.user,
      employee: profile.employee,
    });
  });

  public signup = asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name, inviteToken } = req.body;
    const result = await authService.signup({ email, password, name, inviteToken });
    res.status(201).json(result);
  });

  public verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const token = req.body?.token || (req.query?.token as string);
    const result = await authService.verifyEmail(token);
    res.status(200).json(result);
  });

  public resendVerification = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await authService.resendVerification(email);
    res.status(200).json(result);
  });

  public forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await authService.forgotPassword(email);
    res.status(200).json(result);
  });

  public resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = req.body;
    const result = await authService.resetPassword(token, password);
    res.status(200).json(result);
  });

  public invite = asyncHandler(async (req: Request, res: Response) => {
    const adminUserId = req.user?.userId;
    if (!adminUserId) {
      throw AppError.unauthorized("Authentication required", ApiErrorCode.ERR_UNAUTHORIZED);
    }
    const result = await authService.createStaffInvite(adminUserId, req.body);
    res.status(201).json(result);
  });

  public verifyInvite = asyncHandler(async (req: Request, res: Response) => {
    const token = (req.query?.token as string) || req.body?.token;
    const result = await authService.verifyInvite(token);
    res.status(200).json(result);
  });
}

export const authController = new AuthController();
