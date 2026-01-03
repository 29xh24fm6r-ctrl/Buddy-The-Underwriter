"use client";

import type { SoftConfirmation } from "@/lib/ui/useSoftConfirmations";

/**
 * SoftConfirmationStack
 *
 * Subtle, non-blocking confirmation messages.
 * Appears bottom-right, fades automatically.
 *
 * Rules:
 * - Never blocks user flow
 * - No spinners
 * - No red unless truly broken
 * - Calm, reassuring language only
 */
export function SoftConfirmationStack({
  items,
}: {
  items: SoftConfirmation[];
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto rounded-lg bg-slate-900/95 px-4 py-2 text-sm text-white shadow-lg backdrop-blur transition-all animate-in fade-in slide-in-from-bottom-2"
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
