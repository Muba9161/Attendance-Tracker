import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { clsx } from "clsx";

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg" | "xl" | "2xl";
  presentation?: "drawer" | "modal";
}

const widthMap = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  width = "lg",
  presentation = "drawer",
}) => {
  const { prefersReducedMotion } = useTheme();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const previousBodyOverflow = useRef("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    };

    previousActiveElement.current = document.activeElement as HTMLElement;
    previousBodyOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    // Only set initial focus if focus is not already inside the drawer
    const timer = setTimeout(() => {
      if (drawerRef.current && !drawerRef.current.contains(document.activeElement)) {
        closeBtnRef.current?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousBodyOverflow.current;
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-50 flex",
        presentation === "modal"
          ? "items-center justify-center p-2 sm:p-4"
          : "justify-end"
      )}
    >
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity",
          prefersReducedMotion ? "" : "animate-in fade-in duration-200"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "drawer-title" : undefined}
        className={clsx(
          "relative w-full min-h-0 bg-white dark:bg-slate-900 shadow-2xl z-10 flex flex-col border-slate-200 dark:border-slate-800 transition-colors",
          presentation === "modal"
            ? "max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] rounded-2xl border"
            : "h-full border-l",
          prefersReducedMotion ? "" : "animate-in slide-in-from-right duration-250",
          widthMap[width]
        )}
      >
        {/* Header */}
        <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/80 dark:bg-slate-900/80 shrink-0">
          <div>
            {title && (
              <h3 id="drawer-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 text-slate-700 dark:text-slate-300">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 shrink-0 flex flex-wrap items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
