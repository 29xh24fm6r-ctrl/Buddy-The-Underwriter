"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SafeBoundary } from "@/components/SafeBoundary";

type StatusChipProps = {
  icon: string;
  label: string;
  summary: string;
  status: "ok" | "warn" | "error" | "neutral";
  defaultOpen?: boolean;
  chipKey: string;
  dealId: string;
  children?: React.ReactNode;
};

const STATUS_COLORS = {
  ok:      "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  warn:    "border-amber-500/30 bg-amber-500/5 text-amber-300",
  error:   "border-rose-500/30 bg-rose-500/5 text-rose-300",
  neutral: "border-white/10 bg-white/5 text-white/60",
};

const SUMMARY_COLORS = {
  ok:      "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-rose-400",
  neutral: "text-white/40",
};

export function StatusChip({ icon, label, summary, status, defaultOpen = false, chipKey, dealId, children }: StatusChipProps) {
  const storageKey = `chip:${dealId}:${chipKey}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "1" : defaultOpen;
    } catch { return defaultOpen; }
  });

  const toggle = () => {
    if (!children) return;
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { }
  };

  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={!children}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
          STATUS_COLORS[status],
          children ? "cursor-pointer hover:opacity-80" : "cursor-default",
        )}
      >
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span className="text-white/70">{label}</span>
        <span className={cn("font-semibold", SUMMARY_COLORS[status])}>{summary}</span>
        {children && (
          <span className="material-symbols-outlined text-[12px] text-white/30">
            {open ? "expand_less" : "expand_more"}
          </span>
        )}
      </button>
      {open && children && (
        <div className="absolute z-20 mt-2 w-[480px] max-w-[90vw] rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl">
          <SafeBoundary>{children}</SafeBoundary>
        </div>
      )}
    </div>
  );
}
