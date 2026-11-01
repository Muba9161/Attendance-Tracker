import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { isPasswordStrong } from "@vorldx/shared";

const signupSchema = z
  .object({
    name: z.string().min(2, "Full name must be at least 2 characters").trim(),
    email: z.string().email("Please enter a valid work email address").trim().toLowerCase(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .refine(
        isPasswordStrong,
        "Password must contain uppercase, lowercase, and a number or symbol"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: "You must accept the terms of service" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFormData = z.infer<typeof signupSchema>;

interface InviteDetails {
  email: string;
  role: string;
  name?: string | null;
  department?: string | null;
  designation?: string | null;
}

export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const inviteToken = searchParams.get("invite") || searchParams.get("token") || "";

  const [inviteDetails, setInviteDetails] = useState<InviteDetails | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(!!inviteToken);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Success states
  const [signupSuccess, setSignupSuccess] = useState<boolean>(false);
  const [requiresVerification, setRequiresVerification] = useState<boolean>(true);
  const [registeredEmail, setRegisteredEmail] = useState<string>("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      termsAccepted: true,
    },
  });

  const passwordValue = watch("password") || "";

  // Password Strength Criteria live checks
  const hasMinLength = passwordValue.length >= 8;
  const hasUpper = /[A-Z]/.test(passwordValue);
  const hasLower = /[a-z]/.test(passwordValue);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(passwordValue);

  // Validate invite token on mount if present
  useEffect(() => {
    if (!inviteToken) return;

    let isMounted = true;
    setInviteLoading(true);

    api
      .get<{
        success: boolean;
        valid: boolean;
        email: string;
        role: string;
        name?: string | null;
        department?: string | null;
        designation?: string | null;
        data?: InviteDetails;
      }>(`/api/auth/verify-invite?token=${encodeURIComponent(inviteToken)}`)
      .then((res) => {
        if (!isMounted) return;
        const details: InviteDetails = res.data || {
          email: res.email,
          role: res.role,
          name: res.name,
          department: res.department,
          designation: res.designation,
        };
        setInviteDetails(details);
        if (details.email) setValue("email", details.email);
        if (details.name) setValue("name", details.name);
      })
      .catch((err) => {
        if (!isMounted) return;
        setInviteError(
          err?.message || "This invitation link is invalid or has expired."
        );
      })
      .finally(() => {
        if (isMounted) setInviteLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [inviteToken, setValue]);

  const onSubmit = async (data: SignupFormData) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        requiresEmailVerification?: boolean;
        user: { email: string; role: string };
      }>("/api/auth/signup", {
        name: data.name,
        email: data.email,
        password: data.password,
        inviteToken: inviteToken || undefined,
      });

      setRegisteredEmail(data.email);
      setRequiresVerification(res.requiresEmailVerification ?? !inviteToken);
      setSignupSuccess(true);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Registration failed. Please try again.";
      setServerError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-cyan-500 selection:text-slate-900">
      {/* Background Decorative Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[520px] bg-gradient-to-tr from-blue-600/25 via-indigo-600/20 to-cyan-500/25 rounded-full blur-3xl opacity-75" />
      </div>

      <div className="relative w-full max-w-md space-y-5">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-white p-2 items-center justify-center shadow-xl shadow-blue-500/25 mb-1 ring-4 ring-white/10">
            <img src="/vorldx-logo.png" alt="VorldX" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center justify-center gap-1.5">
            <span>Vorld</span>
            <span className="text-cyan-400">X</span>
            <span className="font-light text-slate-300">Registration</span>
          </h1>
          <p className="text-xs text-slate-400">
            {inviteDetails
              ? `Accept Invitation to join as ${inviteDetails.role}`
              : "Create your account for the VorldX Workforce Platform"}
          </p>
        </div>

        {/* Main Card */}
        <Card className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl transition-colors">
          {/* Invitation Loading Banner */}
          {inviteLoading && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-2 text-xs text-blue-900 dark:text-blue-300">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Verifying your staff invitation...</span>
            </div>
          )}

          {/* Invitation Error Banner */}
          {inviteError && (
            <div className="mb-4 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Invalid Invitation</span>
                {inviteError}
              </div>
            </div>
          )}

          {/* Invitation Verified Badge */}
          {inviteDetails && (
            <div className="mb-5 p-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border border-blue-200 dark:border-blue-800 rounded-xl flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-900 dark:text-blue-200">
                <span className="font-semibold block">Staff Invitation Confirmed</span>
                You have been authorized to join as{" "}
                <span className="font-bold underline uppercase">{inviteDetails.role}</span>.
                Your account will be verified and activated upon completion.
              </div>
            </div>
          )}

          {/* Server Error Alert */}
          {serverError && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs font-medium">{serverError}</div>
            </div>
          )}

          {/* SUCCESS SCREEN */}
          {signupSuccess ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              {requiresVerification ? (
                <>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Verify Your Email Address
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
                    We've dispatched a verification link to{" "}
                    <strong className="text-slate-900 dark:text-slate-100 font-semibold">
                      {registeredEmail}
                    </strong>
                    . Click the link in your email to activate your account.
                  </p>
                  <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
                    Did not receive an email? Check your spam folder or visit the verification portal to resend.
                  </div>
                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      type="button"
                      onClick={() => navigate("/login")}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
                    >
                      Return to Sign In
                    </Button>
                    <Link
                      to="/verify-email"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Resend verification email
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Staff Account Activated!
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
                    Your account has been created with staff privileges. You may now sign in to access the portal.
                  </p>
                  <Button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
                  >
                    Continue to Sign In
                  </Button>
                </>
              )}
            </div>
          ) : (
            /* REGISTRATION FORM */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Full Name */}
              <div>
                <label
                  htmlFor="name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Jane Doe"
                    {...register("name")}
                    className={`w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      errors.name
                        ? "border-rose-500 focus:ring-rose-500"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  />
                </div>
                {errors.name && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Work Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Work Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    placeholder="name@company.com"
                    readOnly={!!inviteDetails?.email}
                    {...register("email")}
                    className={`w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      inviteDetails?.email ? "bg-slate-100 dark:bg-slate-800/40 cursor-not-allowed" : ""
                    } ${
                      errors.email
                        ? "border-rose-500 focus:ring-rose-500"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Create a strong password"
                    {...register("password")}
                    className={`w-full pl-9 pr-10 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      errors.password
                        ? "border-rose-500 focus:ring-rose-500"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Live Password Strength Criteria */}
                <div className="mt-2 p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-1.5 text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold block">
                    Password requirements:
                  </span>
                  <div className="grid grid-cols-2 gap-1 text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className={hasMinLength ? "text-emerald-500 font-bold" : "text-slate-400"}>
                        {hasMinLength ? "✓" : "○"}
                      </span>
                      <span>8+ characters</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={hasUpper ? "text-emerald-500 font-bold" : "text-slate-400"}>
                        {hasUpper ? "✓" : "○"}
                      </span>
                      <span>Uppercase letter</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={hasLower ? "text-emerald-500 font-bold" : "text-slate-400"}>
                        {hasLower ? "✓" : "○"}
                      </span>
                      <span>Lowercase letter</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={hasNumberOrSymbol ? "text-emerald-500 font-bold" : "text-slate-400"}>
                        {hasNumberOrSymbol ? "✓" : "○"}
                      </span>
                      <span>Number or symbol</span>
                    </div>
                  </div>
                </div>

                {errors.password && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    {...register("confirmPassword")}
                    className={`w-full pl-9 pr-10 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      errors.confirmPassword
                        ? "border-rose-500 focus:ring-rose-500"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>

              {/* Terms of Service Checkbox */}
              <div>
                <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-400 select-none">
                  <input
                    type="checkbox"
                    {...register("termsAccepted")}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    I agree to the VorldX Terms of Service and acknowledge the data privacy policy.
                  </span>
                </label>
                {errors.termsAccepted && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {errors.termsAccepted.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || inviteLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all mt-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Creating account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Links & Navigation */}
          {!signupSuccess && (
            <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                >
                  Sign in
                </Link>
              </p>
            </div>
          )}
        </Card>

        {/* Security Assurance Footer */}
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>Single-use encrypted tokens & enterprise RBAC isolation</span>
        </div>
      </div>
    </div>
  );
};

