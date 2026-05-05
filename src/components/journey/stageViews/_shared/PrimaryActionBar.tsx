"use client";

import Link from "next/link";
import type { NextAction } from "@/buddy/lifecycle/nextAction";

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors";

/**
 * Single primary action bar for a stage view. Renders exactly ONE action
 * surfaced by getNextAction. Server-action intents (`runnable`) degrade to
 * a navigate link when href is present (per SPEC-02 — no new endpoints).
 */
export function PrimaryActionBar({
  action,
  dealId,
  description,
}: {
  action: NextAction | null;
  dealId: string;
  description?: string | null;
}) {
  if (!action) {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50"
      >
        No primary action available.
      </div>
    );
  }

  const labelDescription = description ?? action.description;

  if (action.intent === "complete") {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Status</div>
            <div className="text-sm font-semibold text-emerald-100">{action.label}</div>
            {labelDescription ? (
              <div className="mt-1 text-xs text-emerald-200/70">{labelDescription}</div>
            ) : null}
          </div>
          <span className="material-symbols-outlined text-emerald-300">check_circle</span>
        </div>
      </div>
    );
  }

  if (action.intent === "blocked") {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
      >
        <div className="text-[10px] uppercase tracking-wide text-amber-300/80">Blocked</div>
        <div className="text-sm font-semibold text-amber-100">{action.label}</div>
        {labelDescription ? (
          <div className="mt-1 text-xs text-amber-200/80">{labelDescription}</div>
        ) : null}
      </div>
    );
  }

  const href = action.href ?? `/deals/${dealId}/cockpit`;

  return (
    <div
      data-testid="primary-action-bar"
      className="flex flex-col gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-blue-300/80">Next action</div>
        {labelDescription ? (
          <div className="text-xs text-blue-100/80">{labelDescription}</div>
        ) : null}
      </div>
      <Link
        href={href}
        className={`${baseClasses} bg-blue-600 text-white hover:bg-blue-500 self-start sm:self-auto`}
        data-testid="primary-action-cta"
      >
        {action.label}
        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
      </Link>
    </div>
  );
}
