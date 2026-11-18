import { useCallback, useState } from "react";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useAuth } from "../context/AuthContext";

export function useLogoutConfirmation() {
  const { logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const requestLogout = useCallback(() => setIsOpen(true), []);
  const closeDialog = useCallback(() => setIsOpen(false), []);
  const confirmLogout = useCallback(() => {
    setIsOpen(false);
    void logout();
  }, [logout]);

  const dialog = (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={closeDialog}
      onConfirm={confirmLogout}
      title="Sign out of VorldX?"
      message="Are you sure you want to sign out? You’ll need to log in again to access your account."
      confirmText="Sign out"
      cancelText="Stay signed in"
      variant="danger"
    />
  );

  return { requestLogout, dialog };
}
