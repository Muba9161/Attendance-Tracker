import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, AlertCircle, Mail, ArrowRight, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

export const VerifyEmailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"IDLE" | "VERIFYING" | "SUCCESS" | "ERROR">(
    token ? "VERIFYING" : "IDLE"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Resend form state
  const [resendEmail, setResendEmail] = useState<string>("");
  const [isResending, setIsResending] = useState<boolean>(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    setStatus("VERIFYING");

    api
      .post<{ success: boolean; message: string }>("/api/auth/verify-email", { token })
      .then(() => {
        if (!isMounted) return;
        setStatus("SUCCESS");
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Verification failed or token has expired.";
        setErrorMessage(msg);
        setStatus("ERROR");
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) {
      setResendError("Please enter your email address.");
      return;
    }

    setResendError(null);
    setResendSuccess(null);
    setIsResending(true);

    try {
      const res = await api.post<{ success: boolean; message: string }>(
        "/api/auth/resend-verification",
        { email: resendEmail.trim() }
      );
      setResendSuccess(
        res.message || "A new verification link has been dispatched to your email."
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unable to resend verification. Please try again.";
      setResendError(msg);
    } finally {
      setIsResending(false);
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
            <span className="font-light text-slate-300">Email Verification</span>
          </h1>
          <p className="text-xs text-slate-400">
            Cryptographic identity verification for VorldX Workforce
          </p>
        </div>

        {/* Main Card */}
        <Card className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl transition-colors">
          {/* VERIFYING STATE */}
          {status === "VERIFYING" && (
            <div className="text-center py-8 space-y-4">
              <div className="w-12 h-12 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Verifying your email...
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Validating cryptographic token hash with the verification authority.
              </p>
            </div>
          )}

          {/* SUCCESS STATE */}
          {status === "SUCCESS" && (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Email Successfully Verified!
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
                Your email address has been confirmed and your account is active. You may now sign in to your dashboard.
              </p>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={() => navigate("/login?verified=true")}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                >
                  <span>Continue to Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ERROR OR IDLE STATE */}
          {(status === "ERROR" || status === "IDLE") && (
            <div className="space-y-4">
              {status === "ERROR" && (
                <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold block">Verification Failed</span>
                    {errorMessage || "The verification link is invalid or has expired."}
                  </div>
                </div>
              )}

              {status === "IDLE" && (
                <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl flex items-start gap-2.5 text-blue-900 dark:text-blue-300">
                  <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold block">Email Verification Portal</span>
                    Enter your work email address below to receive a new account verification link.
                  </div>
                </div>
              )}

              {resendSuccess && (
                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-2.5 text-emerald-900 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div className="text-xs font-medium">{resendSuccess}</div>
                </div>
              )}

              {resendError && (
                <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                  <div className="text-xs font-medium">{resendError}</div>
                </div>
              )}

              {/* Resend Form */}
              <form onSubmit={handleResend} className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="resendEmail"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Work Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="resendEmail"
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isResending}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all"
                >
                  {isResending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Sending verification link...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Resend Verification Link</span>
                    </>
                  )}
                </Button>
              </form>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center">
            <Link
              to="/login"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
            >
              Return to Sign In
            </Link>
          </div>
        </Card>

        {/* Security Assurance Footer */}
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>SHA-256 token hash validation with 24-hour expiration</span>
        </div>
      </div>
    </div>
  );
};

