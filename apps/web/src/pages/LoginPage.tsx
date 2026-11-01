import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Info,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, "Email or Employee ID is required")
    .transform((val) => val.trim()),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});
type LoginFormData = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const searchParams = new URLSearchParams(location.search);
  const reasonParam = searchParams.get("reason");
  const sessionExpired = reasonParam === "session_expired";
  const sessionRevoked = reasonParam === "session_revoked";
  const forcedLogout = reasonParam === "forced_logout";
  const verifiedNotice = searchParams.get("verified") === "true";
  const resetNotice = searchParams.get("reset") === "true";
  const redirectTarget = searchParams.get("redirect") || "/";

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "admin@vorldx.demo",
      password: "Admin@VorldX2026!",
      rememberMe: true,
    },
  });

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const destination = redirectTarget && redirectTarget !== "/login" ? redirectTarget : "/";
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, isLoading, redirectTarget, navigate]);

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      await login({
        identifier: data.identifier,
        password: data.password,
      });
      const destination = redirectTarget && redirectTarget !== "/login" ? redirectTarget : "/";
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Invalid email or password. Please try again.";
      setServerError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFillDemo = (email: string, pass: string) => {
    setValue("identifier", email);
    setValue("password", pass);
    setServerError(null);
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
            <span className="font-light text-slate-300">Staff Portal</span>
          </h1>
          <p className="text-xs text-slate-400">
            Enterprise Attendance & Biometric QR Infrastructure
          </p>
        </div>

        {/* Main Card */}
        <Card className="p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl transition-colors">
          {/* Notifications & Reason Banners */}
          {verifiedNotice && (
            <div className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-2.5 text-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Email Verified</span>
                Your email address has been verified. You may now sign in.
              </div>
            </div>
          )}

          {resetNotice && (
            <div className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-2.5 text-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Password Reset</span>
                Your password has been updated. Please sign in with your new credentials.
              </div>
            </div>
          )}

          {sessionExpired && (
            <div className="mb-5 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5 text-amber-900 dark:text-amber-300">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Session Expired</span>
                Your authentication session has expired. Please sign in to resume.
              </div>
            </div>
          )}

          {sessionRevoked && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Session Terminated</span>
                Your session was revoked from security settings or another device.
              </div>
            </div>
          )}

          {forcedLogout && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold block">Administrative Force Logout</span>
                An administrator has terminated your staff session.
              </div>
            </div>
          )}

          {serverError && (
            <div className="mb-5 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-rose-900 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs font-medium">{serverError}</div>
            </div>
          )}

          {/* Email + Password Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label
                htmlFor="identifier"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Work Email or Employee ID
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  placeholder="admin@vorldx.demo or ADM-001"
                  {...register("identifier")}
                  className={`w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                    errors.identifier
                      ? "border-rose-500 focus:ring-rose-500"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                />
              </div>
              {errors.identifier && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors.identifier.message}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
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
              {errors.password && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-400 select-none">
                <input
                  type="checkbox"
                  {...register("rememberMe")}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span>Remember this device</span>
              </label>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all mt-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Links & Navigation */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Don't have an account or have an invite?{" "}
              <Link
                to="/signup"
                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
              >
                Sign up
              </Link>
            </p>
          </div>

          {/* Demo Quick-Fill Section */}
          <div className="mt-5 p-3.5 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Development Demo Accounts</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleFillDemo("admin@vorldx.demo", "Admin@VorldX2026!")}
                className="py-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-cyan-400 text-left transition-colors"
              >
                <span className="font-semibold block">Demo Admin</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">
                  admin@vorldx.demo
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleFillDemo("hr@vorldx.demo", "Hr@VorldX2026!")}
                className="py-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-cyan-400 text-left transition-colors"
              >
                <span className="font-semibold block">Demo HR</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate block">
                  hr@vorldx.demo
                </span>
              </button>
            </div>
          </div>
        </Card>

        {/* Security Assurance Footer */}
        <div className="text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>Protected by bcrypt hashing & multi-factor session guard</span>
        </div>
      </div>
    </div>
  );
};
