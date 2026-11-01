import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { validate } from "../middleware/validate";
import { authenticate, requireRole } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import {
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  RegisterStartRequestSchema,
  RegisterVerifyRequestSchema,
  RegisterCompleteRequestSchema,
  SignupRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
  ResendVerificationRequestSchema,
  StaffInviteRequestSchema,
  UserRole,
} from "@vorldx/shared";

const router = Router();

/**
 * @route   POST /api/auth/signup (alias: /auth/signup)
 * @desc    Corporate self-signup or invite acceptance with email and password
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/signup", "/auth/signup"],
  authRateLimiter,
  validate({ body: SignupRequestSchema }),
  authController.signup
);

/**
 * @route   POST /api/auth/verify-email (alias: /auth/verify-email)
 * @desc    Validate single-use email verification token
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/verify-email", "/auth/verify-email"],
  authRateLimiter,
  validate({ body: VerifyEmailRequestSchema }),
  authController.verifyEmail
);

/**
 * @route   POST /api/auth/resend-verification (alias: /auth/resend-verification)
 * @desc    Dispatches a new verification token to an unverified email address
 * @access  Public (Rate-limited, Anti-enumeration)
 */
router.post(
  ["/api/auth/resend-verification", "/auth/resend-verification"],
  authRateLimiter,
  validate({ body: ResendVerificationRequestSchema }),
  authController.resendVerification
);

/**
 * @route   POST /api/auth/forgot-password (alias: /auth/forgot-password)
 * @desc    Dispatches single-use password reset link
 * @access  Public (Rate-limited, Anti-enumeration)
 */
router.post(
  ["/api/auth/forgot-password", "/auth/forgot-password"],
  authRateLimiter,
  validate({ body: ForgotPasswordRequestSchema }),
  authController.forgotPassword
);

/**
 * @route   POST /api/auth/reset-password (alias: /auth/reset-password)
 * @desc    Resets user password with strength check and single-use token consumption
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/reset-password", "/auth/reset-password"],
  authRateLimiter,
  validate({ body: ResetPasswordRequestSchema }),
  authController.resetPassword
);

/**
 * @route   POST /api/auth/invite (alias: /auth/invite)
 * @desc    Generate expiring staff invitation link for HR or Admin role
 * @access  Protected (ADMIN only)
 */
router.post(
  ["/api/auth/invite", "/auth/invite"],
  authenticate,
  requireRole(UserRole.ADMIN),
  validate({ body: StaffInviteRequestSchema }),
  authController.invite
);

/**
 * @route   GET /api/auth/verify-invite (alias: /auth/verify-invite)
 * @desc    Validates invitation token before showing staff signup form
 * @access  Public (Rate-limited)
 */
router.get(
  ["/api/auth/verify-invite", "/auth/verify-invite"],
  authRateLimiter,
  authController.verifyInvite
);

/**
 * @route   POST /api/auth/register-start
 * @desc    Initiate self-registration by generating a secure 6-digit OTP
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/register-start", "/auth/register-start"],
  authRateLimiter,
  validate({ body: RegisterStartRequestSchema }),
  authController.registerStart
);

/**
 * Backward compatibility alias for register-start
 */
router.post(
  ["/api/auth/register", "/auth/register"],
  authRateLimiter,
  validate({ body: RegisterStartRequestSchema }),
  authController.registerStart
);

/**
 * @route   POST /api/auth/register-verify
 * @desc    Verify single-use OTP (with or without password)
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/register-verify", "/auth/register-verify"],
  authRateLimiter,
  validate({ body: RegisterVerifyRequestSchema }),
  authController.registerVerify
);

/**
 * Backward compatibility alias for register-verify
 */
router.post(
  ["/api/auth/verify-otp", "/auth/verify-otp"],
  authRateLimiter,
  validate({ body: RegisterVerifyRequestSchema }),
  authController.registerVerify
);

/**
 * @route   POST /api/auth/register-complete
 * @desc    Complete registration with verification token and set account password
 * @access  Public (Rate-limited)
 */
router.post(
  ["/api/auth/register-complete", "/auth/register-complete"],
  authRateLimiter,
  validate({ body: RegisterCompleteRequestSchema }),
  authController.registerComplete
);

/**
 * @route   POST /api/auth/login (alias: /auth/login)
 * @desc    Authenticate employee/admin credentials and obtain JWT tokens
 * @access  Public
 */
router.post(
  ["/api/auth/login", "/auth/login"],
  authRateLimiter,
  validate({ body: LoginRequestSchema }),
  authController.login
);

/**
 * @route   POST /api/auth/refresh (alias: /auth/refresh)
 * @desc    Rotate refresh token and issue new access token
 * @access  Public (Requires valid refresh token)
 */
router.post(
  ["/api/auth/refresh", "/auth/refresh"],
  authRateLimiter,
  validate({ body: RefreshTokenRequestSchema }),
  authController.refresh
);

/**
 * @route   POST /api/auth/logout (alias: /auth/logout)
 * @desc    Clear refresh token from database and wipe session cookie
 * @access  Public / Authenticated
 */
router.post(["/api/auth/logout", "/auth/logout"], authController.logout);

/**
 * @route   GET /api/auth/me (alias: /auth/me)
 * @desc    Retrieve currently authenticated user and employee record
 * @access  Protected (Requires Bearer access token)
 */
router.get(["/api/auth/me", "/auth/me"], authenticate, authController.getCurrentUser);

export default router;
