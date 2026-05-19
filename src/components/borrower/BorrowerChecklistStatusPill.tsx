"use client";

import { cn } from "@/lib/cn";

export type BorrowerChecklistTone =
  | "required"
  | "reviewing"
  | "complete"
  | "inflight"
  | "optional";

export function BorrowerChecklistStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: BorrowerChecklistTone;
}) {
  const styles = {
    required: "bg-amber-100 text-amber-900",
    reviewing: "bg-sky-100 text-sky-900",
    complete: "bg-emerald-100 text-emerald-900",
    inflight: "bg-stone-100 text-stone-800",
    optional: "bg-stone-100 text-stone-700",
  } satisfies Record<BorrowerChecklistTone, string>;

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
        styles[tone],
      )}
    >
      {label}
    </span>
  );
}
