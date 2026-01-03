"use client";

import type { SoftConfirmation } from "@/lib/ui/useSoftConfirmations";

type SoftConfirmationStackProps = {
  items: SoftConfirmation[];
};

/**
 * SoftConfirmationStack - Subtle, auto-dismissing confirmation messages
 * 
 * Appears in top-right, fades in/out smoothly.
 * Non-blocking (pointer-events-none on container).
 * Dark, calm aesthetic.
 */
export function SoftConfirmationStack({ items }: SoftConfirmationStackProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="animate-in fade-in slide-in-from-right-2 duration-200 rounded-lg bg-slate-900/90 px-4 py-2 text-xs text-slate-200 shadow-lg backdrop-blur-sm border border-slate-700/50"
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
