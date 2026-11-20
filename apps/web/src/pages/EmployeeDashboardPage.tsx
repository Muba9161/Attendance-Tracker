import React from "react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { useLogoutConfirmation } from "../hooks/useLogoutConfirmation";

export const EmployeeDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { requestLogout, dialog: logoutDialog } = useLogoutConfirmation();

  return (
    <>
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">VORLDX Employee Portal</p>
            <h1 className="mt-2 text-2xl font-bold">Welcome, {user?.name || "Employee"}</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your employee account is active.</p>
          </div>
          <Button type="button" variant="secondary" onClick={requestLogout}>Sign out</Button>
        </div>
        <dl className="mt-8 grid gap-4 border-t border-slate-200 pt-6 dark:border-slate-800 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Employee ID</dt>
            <dd className="mt-1 font-semibold">{user?.employeeId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-1 font-semibold">{user?.email}</dd>
          </div>
        </dl>
      </div>
    </main>
    {logoutDialog}
    </>
  );
};

