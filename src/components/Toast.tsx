import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
  id?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = "info",
  duration = 4000,
  onClose,
  id,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (duration > 0 && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  const getTypeStyles = () => {
    switch (type) {
      case "success":
        return {
          bg: "bg-emerald-600 dark:bg-emerald-600 text-white border-emerald-500 shadow-emerald-500/30",
          icon: <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-100" />,
        };
      case "error":
        return {
          bg: "bg-rose-600 dark:bg-rose-600 text-white border-rose-500 shadow-rose-500/30",
          icon: <AlertTriangle className="w-4 h-4 shrink-0 text-rose-100" />,
        };
      case "warning":
        return {
          bg: "bg-amber-600 dark:bg-amber-600 text-white border-amber-500 shadow-amber-500/30",
          icon: <AlertCircle className="w-4 h-4 shrink-0 text-amber-100" />,
        };
      case "info":
      default:
        return {
          bg: "bg-slate-900 dark:bg-slate-900 text-white border-slate-700 shadow-slate-900/40",
          icon: <Info className="w-4 h-4 shrink-0 text-slate-300" />,
        };
    }
  };

  const { bg, icon } = getTypeStyles();

  const toastElement = (
    <div
      className="fixed bottom-6 right-6 z-[99999] pointer-events-none max-w-[92vw] sm:max-w-md"
      style={{ zIndex: 99999 }}
      id={id || "app-toast-portal-container"}
    >
      <div
        role="alert"
        aria-live="assertive"
        className={`pointer-events-auto px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 animate-slideUp text-xs font-bold transition-all ${bg}`}
      >
        {icon}
        <span className="flex-1 leading-snug break-words">{message}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/20 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(toastElement, document.body);
};

export default Toast;
