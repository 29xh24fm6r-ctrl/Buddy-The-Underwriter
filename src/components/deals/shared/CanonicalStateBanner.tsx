"use client";
import Link from "next/link";
import type { SystemAction } from "@/core/state/types";

interface Props { action: SystemAction; variant?: "strip" | "card"; }

export function CanonicalStateBanner({ action, variant = "strip" }: Props) {
  const isBlocked = action.intent === "blocked";
  const isComplete = action.intent === "complete";
  const colorClass = isBlocked ? "bg-amber-50 border-amber-200 text-amber-900"
    : isComplete ? "bg-green-50 border-green-200 text-green-900"
    : "bg-blue-50 border-blue-200 text-blue-900";
  const base = variant === "card" ? `rounded-xl border p-4 ${colorClass}` : `rounded-lg border px-4 py-2.5 ${colorClass}`;
  return (
    <div className={`flex items-center justify-between gap-4 ${base}`}>
      <div>
        <p className="text-sm font-medium">{action.label}</p>
        {action.description && <p className="mt-0.5 text-xs opacity-75">{action.description}</p>}
      </div>
      {action.href && !isBlocked && (
        <Link href={action.href} className="shrink-0 rounded-md bg-white/80 px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-white">Go &rarr;</Link>
      )}
    </div>
  );
}
