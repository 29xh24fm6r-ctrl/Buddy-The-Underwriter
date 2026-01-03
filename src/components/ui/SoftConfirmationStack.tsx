"use client";

import type { SoftConfirmation } from "@/lib/ui/useSoftConfirmations";

export function SoftConfirmationStack({ items }: { items: SoftConfirmation[] }) {
  if (!items?.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 space-y-2">
      {items.map((i) => (
        <div
          key={i.id}
          className="rounded-lg bg-slate-950/80 px-4 py-2 text-xs text-slate-200 shadow-lg backdrop-blur"
        >
          {i.message}
        </div>
      ))}
    </div>
  );
}
