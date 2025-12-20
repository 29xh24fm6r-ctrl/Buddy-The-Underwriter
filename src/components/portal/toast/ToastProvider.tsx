"use client";

import * as React from "react";

type Toast = {
  id: string;
  title: string;
  detail?: string;
};

type Ctx = {
  toast: (t: { title: string; detail?: string }) => void;
};

const ToastContext = React.createContext<Ctx | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const toast = React.useCallback((t: { title: string; detail?: string }) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const toast: Toast = { id, title: t.title, detail: t.detail };
    setToasts((prev) => [...prev, toast]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {props.children}

      {/* Toast Stack */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in fade-in slide-in-from-right-2 rounded-2xl border bg-white p-3 shadow-md">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.detail ? <div className="mt-1 text-xs text-gray-600">{t.detail}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
