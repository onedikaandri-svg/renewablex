"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IconClose } from "@/components/Icons";

export interface ToastItem {
  id: string;
  message: string;
  tone: "info" | "success" | "error";
}

interface ToastContextValue {
  pushToast: (message: string, tone?: "info" | "success" | "error") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (items.length === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setItems((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length]);

  const pushToast = useCallback((message: string, tone: "info" | "success" | "error" = "info") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`toast ${item.tone === "error" ? "toast-error" : item.tone === "success" ? "toast-success" : ""}`}
          >
            <span>{item.message}</span>
            <button
              type="button"
              className="seg-btn seg-icon"
              style={{ color: "inherit", minWidth: "2.75rem", minHeight: "2.75rem" }}
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
              aria-label="Tutup notifikasi"
              title="Tutup notifikasi"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast harus dipanggil di dalam ToastProvider.");
  }
  return ctx;
}
