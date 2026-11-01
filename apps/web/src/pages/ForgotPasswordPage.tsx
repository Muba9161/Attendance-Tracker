import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, ShieldCheck } from "lucide-react";
import { api } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid work email address").trim().toLowerCase(),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export const ForgotPasswordPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState<boolean>(false);
  const [submittedEmail, setSubmittedEmail] = useState<string>("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/forgot-password", { email: data.email });
      setSubmittedEmail(data.email);
      setIsSent(true);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Unable to process request. Please try again.";
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
            <span className="font-light text-slate-300">Password Recovery</span>
          </h1>
          <p className="text-xs text-slate-400">
            Request an encrypted single-use password reset link
          </p>
        </div>

        {/* Main Card */}
        <Card className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl transition-colors">
          {serverError && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs font-medium">{serverError}</div>
            </div>
          )}

          {isSent ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Password Reset Link Dispatched
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
                If an account exists with{" "}
                <strong className="text-slate-900 dark:text-slate-100 font-semibold">
                  {submittedEmail}
                </strong>
                , a password reset link has been sent. This link expires in 1 hour.
              </p>
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
                Didn't receive an email? Check your spam folder or verify you typed the correct email address.
              </div>
              <div className="pt-2">
                <Link to="/login">
                  <Button className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Sign In</span>
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                    {...register("email")}
                    className={`w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
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

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all mt-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sending reset link...</span>
                  </>
                ) : (
                  <>
                    <span>Send Reset Link</span>
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
          <span>Anti-enumeration protected & 60-minute token validity</span>
        </div>
      </div>
    </div>
  );
};

