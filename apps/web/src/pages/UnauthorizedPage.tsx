import React from "react";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { useLogoutConfirmation } from "../hooks/useLogoutConfirmation";

export const UnauthorizedPage: React.FC = () => {
  const { user } = useAuth();
  const { requestLogout, dialog: logoutDialog } = useLogoutConfirmation();
  const isEmployee = user?.role === "EMPLOYEE";

  return (
    <>
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6">
      <div className="w-16 h-16 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4 shadow-xs border border-rose-200 dark:border-rose-800">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
        {isEmployee ? "Employee account created" : "Access Restricted"}
      </h1>
      <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mt-2">
        {isEmployee
          ? "Your account is an employee account. This web dashboard is for HR and Admin staff. Contact your HR team if you need staff portal access."
          : "You do not have administrative permissions to view this module. This section is restricted to authorized HR and Admin accounts."}
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" onClick={requestLogout}>
          <LogOut className="w-4 h-4 mr-1.5" />
          Sign out
        </Button>
      </div>
    </div>
    {logoutDialog}
    </>
  );
};
