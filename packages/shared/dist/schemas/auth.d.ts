import { z } from "zod";
import { UserRole } from "../constants/enums";
export declare const RegisterStartRequestSchema: z.ZodObject<{
    employeeId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
}, {
    employeeId: string;
}>;
export type RegisterStartRequest = z.infer<typeof RegisterStartRequestSchema>;
export declare const RegisterVerifyRequestSchema: z.ZodObject<{
    employeeId: z.ZodString;
    otp: z.ZodString;
    password: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    otp: string;
    password?: string | undefined;
}, {
    employeeId: string;
    otp: string;
    password?: string | undefined;
}>;
export type RegisterVerifyRequest = z.infer<typeof RegisterVerifyRequestSchema>;
export declare const RegisterCompleteRequestSchema: z.ZodObject<{
    employeeId: z.ZodString;
    verificationToken: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    password: string;
    verificationToken: string;
}, {
    employeeId: string;
    password: string;
    verificationToken: string;
}>;
export type RegisterCompleteRequest = z.infer<typeof RegisterCompleteRequestSchema>;
export declare const RegisterRequestSchema: z.ZodObject<{
    employeeId: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    password: string;
}, {
    employeeId: string;
    password: string;
}>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export declare const VerifyOtpRequestSchema: z.ZodObject<{
    employeeId: z.ZodString;
    otp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    otp: string;
}, {
    employeeId: string;
    otp: string;
}>;
export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequestSchema>;
export declare const LoginRequestSchema: z.ZodEffects<z.ZodObject<{
    employeeId: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
    identifier: z.ZodOptional<z.ZodString>;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    password: string;
    employeeId?: string | undefined;
    email?: string | undefined;
    identifier?: string | undefined;
}, {
    password: string;
    employeeId?: string | undefined;
    email?: string | undefined;
    identifier?: string | undefined;
}>, {
    password: string;
    employeeId?: string | undefined;
    email?: string | undefined;
    identifier?: string | undefined;
}, {
    password: string;
    employeeId?: string | undefined;
    email?: string | undefined;
    identifier?: string | undefined;
}>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export declare const RefreshTokenRequestSchema: z.ZodObject<{
    refreshToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    refreshToken?: string | undefined;
}, {
    refreshToken?: string | undefined;
}>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export declare const AuthUserSchema: z.ZodObject<{
    _id: z.ZodString;
    employeeId: z.ZodString;
    name: z.ZodString;
    email: z.ZodString;
    role: z.ZodNativeEnum<typeof UserRole>;
    department: z.ZodOptional<z.ZodString>;
    designation: z.ZodOptional<z.ZodString>;
    isVerified: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    email: string;
    _id: string;
    name: string;
    role: UserRole;
    isVerified: boolean;
    department?: string | undefined;
    designation?: string | undefined;
}, {
    employeeId: string;
    email: string;
    _id: string;
    name: string;
    role: UserRole;
    isVerified: boolean;
    department?: string | undefined;
    designation?: string | undefined;
}>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
/**
 * Validates password strength:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit or special character
 */
export declare function isPasswordStrong(password: string): boolean;
export declare const SignupRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodEffects<z.ZodString, string, string>;
    name: z.ZodString;
    inviteToken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    password: string;
    email: string;
    name: string;
    inviteToken?: string | undefined;
}, {
    password: string;
    email: string;
    name: string;
    inviteToken?: string | undefined;
}>;
export type SignupRequest = z.infer<typeof SignupRequestSchema>;
export declare const ForgotPasswordRequestSchema: z.ZodObject<{
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;
export declare const ResetPasswordRequestSchema: z.ZodObject<{
    token: z.ZodString;
    password: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    password: string;
    token: string;
}, {
    password: string;
    token: string;
}>;
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
export declare const VerifyEmailRequestSchema: z.ZodObject<{
    token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    token: string;
}, {
    token: string;
}>;
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;
export declare const ResendVerificationRequestSchema: z.ZodObject<{
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;
export declare const StaffInviteRequestSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<[UserRole.HR, UserRole.ADMIN, UserRole.HR_ADMIN]>>;
    name: z.ZodOptional<z.ZodString>;
    department: z.ZodOptional<z.ZodString>;
    designation: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email: string;
    role: UserRole.ADMIN | UserRole.HR | UserRole.HR_ADMIN;
    name?: string | undefined;
    department?: string | undefined;
    designation?: string | undefined;
}, {
    email: string;
    name?: string | undefined;
    role?: UserRole.ADMIN | UserRole.HR | UserRole.HR_ADMIN | undefined;
    department?: string | undefined;
    designation?: string | undefined;
}>;
export type StaffInviteRequest = z.infer<typeof StaffInviteRequestSchema>;
export declare const VerifyInviteRequestSchema: z.ZodObject<{
    token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    token: string;
}, {
    token: string;
}>;
export type VerifyInviteRequest = z.infer<typeof VerifyInviteRequestSchema>;
//# sourceMappingURL=auth.d.ts.map