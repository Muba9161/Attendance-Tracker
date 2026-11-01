import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, ShieldCheck, ArrowRight, ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { isPasswordStrong } from "@vorldx/shared";

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .refine(
        isPasswordStrong,
        "Password must contain uppercase, lowercase, and a number or symbol"
      ),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const token = searchParams.get("token") || "";

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordValue = watch("password") || "";
  const hasMinLength = passwordValue.length >= 8;
  const hasUpper = /[A-Z]/.test(passwordValue);
  const hasLower = /[a-z]/.test(passwordValue);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(passwordValue);

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      setServerError("Reset token is missing from the URL. Please click the link in your email.");
      return;
    }

    setServerError(null);
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/reset-password", {
        token,
        password: data.password,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Invalid or expired reset link. Please request a new link.";
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
            <span className="font-light text-slate-300">Set New Password</span>
          </h1>
          <p className="text-xs text-slate-400">
            Create a new secure password for your VorldX account
          </p>
        </div>

        {/* Main Card */}
        <Card className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl transition-colors">
          {!token && !isSuccess && (
            <div className="mb-5 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5 text-amber-900 dark:text-amber-300">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Missing Reset Token</span>
                No reset token was detected in the URL. Please use the exact link sent to your email.
              </div>
            </div>
          )}

          {serverError && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs font-medium">{serverError}</div>
            </div>
          )}

          {isSuccess ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Password Successfully Reset
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
                Your password has been securely updated. You can now sign in using your new credentials.
              </p>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={() => navigate("/login?reset=true")}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
                >
                  Continue to Sign In
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* New Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Enter your new password"
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

                {/* Password Strength Checklist */}
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

              {/* Confirm New Password */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
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

              <Button
                type="submit"
                disabled={isSubmitting || !token}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all mt-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Updating password...</span>
                  </>
                ) : (
                  <>
                    <span>Reset Password</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center">
            <Link
              to="/login"
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-1 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </Card>

        {/* Security Assurance Footer */}
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>Invalidates all active sessions upon password reset</span>
        </div>
      </div>
    </div>
  );
};

