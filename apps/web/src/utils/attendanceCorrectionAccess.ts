import { UserRole } from "@vorldx/shared";

export function canCorrectAttendance(role: string | undefined): boolean {
  return role === UserRole.ADMIN;
}
