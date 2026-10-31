import { z } from "zod";
import { UserRole } from "../constants/enums";

export const RegisterStartRequestSchema = z.object({
  employeeId: z
    .string()
    .min(3, "Employee ID must be at least 3 characters")
    .max(20, "Employee ID cannot exceed 20 characters")
    .trim(),
});

export type RegisterStartRequest = z.infer<typeof RegisterStartRequestSchema>;

export const RegisterVerifyRequestSchema = z.object({
  employeeId: z
    .string()
    .min(3, "Employee ID must be at least 3 characters")
    .max(20, "Employee ID cannot exceed 20 characters")
    .trim(),
  otp: z
    .string()
    .trim()
    .length(6, "Verification code must be exactly 6 digits")
    .regex(/^\d{6}$/, "Verification code must contain only numeric digits"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password cannot exceed 100 characters")
    .optional(),
});

export type RegisterVerifyRequest = z.infer<typeof RegisterVerifyRequestSchema>;

export const RegisterCompleteRequestSchema = z.object({
  employeeId: z
    .string()
    .min(3, "Employee ID must be at least 3 characters")
    .max(20, "Employee ID cannot exceed 20 characters")
    .trim(),
  verificationToken: z.string().min(1, "Verification token is required"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password cannot exceed 100 characters"),
});

export type RegisterCompleteRequest = z.infer<typeof RegisterCompleteRequestSchema>;

export const RegisterRequestSchema = z.object({
  employeeId: z
    .string()
    .min(3, "Employee ID must be at least 3 characters")
    .max(20, "Employee ID cannot exceed 20 characters")
    .trim(),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password cannot exceed 100 characters"),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const VerifyOtpRequestSchema = z.object({
  employeeId: z.string().trim().min(1, "Employee ID is required"),
  otp: z.string().trim().length(6, "OTP must be exactly 6 characters"),
});

export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequestSchema>;

export const LoginRequestSchema = z
  .object({
    employeeId: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
    identifier: z.string().trim().optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((data) => Boolean(data.employeeId || data.email || data.identifier), {
    message: "An employeeId, email, or identifier is required for login",
    path: ["employeeId"],
  });

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().optional(),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export const AuthUserSchema = z.object({
  _id: z.string(),
  employeeId: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  department: z.string().optional(),
  designation: z.string().optional(),
  isVerified: z.boolean(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * Validates password strength:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit or special character
 */
export function isPasswordStrong(password: string): boolean {
  if (!password || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);
  return hasUpper && hasLower && hasNumberOrSymbol;
}

export const SignupRequestSchema = z.object({
  email: z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password cannot exceed 128 characters")
    .refine(isPasswordStrong, {
      message: "Password must contain at least one uppercase letter, one lowercase letter, and one number or special character",
    }),
  name: z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
  inviteToken: z.string().trim().optional(),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().trim().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password cannot exceed 128 characters")
    .refine(isPasswordStrong, {
      message: "Password must contain at least one uppercase letter, one lowercase letter, and one number or special character",
    }),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const VerifyEmailRequestSchema = z.object({
  token: z.string().trim().min(1, "Verification token is required"),
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z.object({
  email: z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
});
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

export const StaffInviteRequestSchema = z.object({
  email: z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
  role: z.enum([UserRole.HR, UserRole.ADMIN, UserRole.HR_ADMIN]).default(UserRole.HR),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100).optional(),
  department: z.string().trim().max(100).optional(),
  designation: z.string().trim().max(100).optional(),
});
export type StaffInviteRequest = z.infer<typeof StaffInviteRequestSchema>;

export const VerifyInviteRequestSchema = z.object({
  token: z.string().trim().min(1, "Invitation token is required"),
});
export type VerifyInviteRequest = z.infer<typeof VerifyInviteRequestSchema>;
