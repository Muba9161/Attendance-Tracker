import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ToastProvider } from "./components/ui/Toast";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleGuard } from "./routes/RoleGuard";
import { AppShell } from "./components/layout/AppShell";
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import("./pages/SignupPage").then((module) => ({ default: module.SignupPage })));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage").then((module) => ({ default: module.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage").then((module) => ({ default: module.VerifyEmailPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const AttendanceLedgerPage = lazy(() => import("./pages/AttendanceLedgerPage").then((module) => ({ default: module.AttendanceLedgerPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const WfhPage = lazy(() => import("./pages/WfhPage").then((module) => ({ default: module.WfhPage })));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const PoliciesPage = lazy(() => import("./pages/PoliciesPage").then((module) => ({ default: module.PoliciesPage })));
const DisplaysPage = lazy(() => import("./pages/DisplaysPage").then((module) => ({ default: module.DisplaysPage })));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage").then((module) => ({ default: module.AuditLogsPage })));
const SecurityPage = lazy(() => import("./pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));
const CalendarPage = lazy(() => import("./pages/CalendarPage").then((module) => ({ default: module.CalendarPage })));
const LeavePage = lazy(() => import("./pages/LeavePage").then((module) => ({ default: module.LeavePage })));
const AnnouncementsPage = lazy(() => import("./pages/AnnouncementsPage").then((module) => ({ default: module.AnnouncementsPage })));
const EnquiriesPage = lazy(() => import("./pages/EnquiriesPage").then((module) => ({ default: module.EnquiriesPage })));
const AppReleasesPage = lazy(() => import("./pages/AppReleasesPage").then((module) => ({ default: module.AppReleasesPage })));
const UnauthorizedPage = lazy(() => import("./pages/UnauthorizedPage").then((module) => ({ default: module.UnauthorizedPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const EmployeeDashboardPage = lazy(() => import("./pages/EmployeeDashboardPage").then((module) => ({ default: module.EmployeeDashboardPage })));
const HrManagementPage = lazy(() => import("./pages/HrManagementPage").then((module) => ({ default: module.HrManagementPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
          <SocketProvider>
            <BrowserRouter>
              <Suspense fallback={null}>
              <Routes>
                {/* Public Authentication Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />

                {/* Protected Administrative Application Shell */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<RoleGuard allowedRoles={["EMPLOYEE"]} allowAdminBypass={false} />}>
                    <Route path="/employee-dashboard" element={<EmployeeDashboardPage />} />
                  </Route>
                  <Route element={<AppShell />}>
                    {/* Role-Guarded HR & Admin Routes */}
                    <Route element={<RoleGuard allowedRoles={["HR", "ADMIN", "HR_ADMIN"]} />}>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/dashboard" element={<Navigate to="/" replace />} />
                      <Route path="/attendance" element={<AttendanceLedgerPage />} />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route path="/wfh" element={<WfhPage />} />
                      <Route path="/employees" element={<EmployeesPage />} />
                      <Route path="/policies" element={<PoliciesPage />} />
                      <Route path="/calendar" element={<CalendarPage />} />
                      <Route path="/leave" element={<LeavePage />} />
                      <Route path="/leave-requests" element={<Navigate to="/leave" replace />} />
                      <Route path="/leave/settings" element={<Navigate to="/leave?tab=settings" replace />} />
                      <Route path="/announcements" element={<AnnouncementsPage />} />
                      <Route path="/enquiries" element={<EnquiriesPage />} />
                      <Route path="/helpdesk" element={<Navigate to="/enquiries" replace />} />
                      <Route path="/displays" element={<DisplaysPage />} />
                      <Route path="/audit-logs" element={<AuditLogsPage />} />
                      <Route element={<RoleGuard allowedRoles={["ADMIN"]} />}>
                        <Route path="/hr-management" element={<HrManagementPage />} />
                        <Route path="/security" element={<SecurityPage />} />
                        <Route path="/settings/security" element={<Navigate to="/security" replace />} />
                        <Route path="/releases" element={<AppReleasesPage />} />
                        <Route path="/admin/releases" element={<Navigate to="/releases" replace />} />
                      </Route>
                    </Route>

                    {/* Common Protected Fallbacks */}
                    <Route path="/unauthorized" element={<UnauthorizedPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
              </Suspense>
            </BrowserRouter>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>
  );
};

export default App;

