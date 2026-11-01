"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerifyInviteRequestSchema = exports.StaffInviteRequestSchema = exports.ResendVerificationRequestSchema = exports.VerifyEmailRequestSchema = exports.ResetPasswordRequestSchema = exports.ForgotPasswordRequestSchema = exports.SignupRequestSchema = exports.AuthUserSchema = exports.RefreshTokenRequestSchema = exports.LoginRequestSchema = exports.VerifyOtpRequestSchema = exports.RegisterRequestSchema = exports.RegisterCompleteRequestSchema = exports.RegisterVerifyRequestSchema = exports.RegisterStartRequestSchema = void 0;
exports.isPasswordStrong = isPasswordStrong;
const zod_1 = require("zod");
const enums_1 = require("../constants/enums");
exports.RegisterStartRequestSchema = zod_1.z.object({
    employeeId: zod_1.z
        .string()
        .min(3, "Employee ID must be at least 3 characters")
        .max(20, "Employee ID cannot exceed 20 characters")
        .trim(),
});
exports.RegisterVerifyRequestSchema = zod_1.z.object({
    employeeId: zod_1.z
        .string()
        .min(3, "Employee ID must be at least 3 characters")
        .max(20, "Employee ID cannot exceed 20 characters")
        .trim(),
    otp: zod_1.z
        .string()
        .trim()
        .length(6, "Verification code must be exactly 6 digits")
        .regex(/^\d{6}$/, "Verification code must contain only numeric digits"),
    password: zod_1.z
        .string()
        .min(6, "Password must be at least 6 characters")
        .max(100, "Password cannot exceed 100 characters")
        .optional(),
});
exports.RegisterCompleteRequestSchema = zod_1.z.object({
    employeeId: zod_1.z
        .string()
        .min(3, "Employee ID must be at least 3 characters")
        .max(20, "Employee ID cannot exceed 20 characters")
        .trim(),
    verificationToken: zod_1.z.string().min(1, "Verification token is required"),
    password: zod_1.z
        .string()
        .min(6, "Password must be at least 6 characters")
        .max(100, "Password cannot exceed 100 characters"),
});
exports.RegisterRequestSchema = zod_1.z.object({
    employeeId: zod_1.z
        .string()
        .min(3, "Employee ID must be at least 3 characters")
        .max(20, "Employee ID cannot exceed 20 characters")
        .trim(),
    password: zod_1.z
        .string()
        .min(6, "Password must be at least 6 characters")
        .max(100, "Password cannot exceed 100 characters"),
});
exports.VerifyOtpRequestSchema = zod_1.z.object({
    employeeId: zod_1.z.string().trim().min(1, "Employee ID is required"),
    otp: zod_1.z.string().trim().length(6, "OTP must be exactly 6 characters"),
});
exports.LoginRequestSchema = zod_1.z
    .object({
    employeeId: zod_1.z.string().trim().optional(),
    email: zod_1.z.string().trim().email().optional(),
    identifier: zod_1.z.string().trim().optional(),
    password: zod_1.z.string().min(1, "Password is required"),
})
    .refine((data) => Boolean(data.employeeId || data.email || data.identifier), {
    message: "An employeeId, email, or identifier is required for login",
    path: ["employeeId"],
});
exports.RefreshTokenRequestSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().optional(),
});
exports.AuthUserSchema = zod_1.z.object({
    _id: zod_1.z.string(),
    employeeId: zod_1.z.string(),
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    role: zod_1.z.nativeEnum(enums_1.UserRole),
    department: zod_1.z.string().optional(),
    designation: zod_1.z.string().optional(),
    isVerified: zod_1.z.boolean(),
});
/**
 * Validates password strength:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit or special character
 */
function isPasswordStrong(password) {
    if (!password || password.length < 8)
        return false;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);
    return hasUpper && hasLower && hasNumberOrSymbol;
}
exports.SignupRequestSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
    password: zod_1.z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(128, "Password cannot exceed 128 characters")
        .refine(isPasswordStrong, {
        message: "Password must contain at least one uppercase letter, one lowercase letter, and one number or special character",
    }),
    name: zod_1.z.string().trim().min(2, "Full name must be at least 2 characters").max(100),
    inviteToken: zod_1.z.string().trim().optional(),
});
exports.ForgotPasswordRequestSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
});
exports.ResetPasswordRequestSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(1, "Reset token is required"),
    password: zod_1.z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(128, "Password cannot exceed 128 characters")
        .refine(isPasswordStrong, {
        message: "Password must contain at least one uppercase letter, one lowercase letter, and one number or special character",
    }),
});
exports.VerifyEmailRequestSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(1, "Verification token is required"),
});
exports.ResendVerificationRequestSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
});
exports.StaffInviteRequestSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email("Please provide a valid corporate email address").toLowerCase(),
    role: zod_1.z.enum([enums_1.UserRole.HR, enums_1.UserRole.ADMIN, enums_1.UserRole.HR_ADMIN]).default(enums_1.UserRole.HR),
    name: zod_1.z.string().trim().min(2, "Name must be at least 2 characters").max(100).optional(),
    department: zod_1.z.string().trim().max(100).optional(),
    designation: zod_1.z.string().trim().max(100).optional(),
});
exports.VerifyInviteRequestSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(1, "Invitation token is required"),
});
