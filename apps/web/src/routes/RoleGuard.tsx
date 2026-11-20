import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "@vorldx/shared";

export interface RoleGuardProps {
  allowedRoles: string[];
  allowAdminBypass?: boolean;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, allowAdminBypass = true }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Superuser admin bypass
  if (allowAdminBypass && (user.role === UserRole.ADMIN || user.role === "ADMIN")) {
    return <Outlet />;
  }

  const hasRole = allowedRoles.includes(user.role);

  if (!hasRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};

