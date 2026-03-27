"use client";

import type { BuddyNextAction } from "@/core/actions/types";

/**
 * DealNextActionsPanel — Phase 65D
 *
 * Renders canonical next actions. No logic beyond display formatting.
 * All action semantics come from derivation utilities.
 */

const PRIORITY_STYLES: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  high: "border-amber-200 bg-amber-50 text-amber-800",
  normal: "border-neutral-200 bg-neutral-50 text-neutral-700",
};

export function DealNextActionsPanel({
  nextActions,
  primaryAction,
}: {
  nextActions: BuddyNextAction[];
  primaryAction: BuddyNextAction | null;
}) {
  if (nextActions.length === 0) return null;

  return (
    <section data-testid="deal-next-actions-panel" data-buddy-actions="true" className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        What Needs to Happen Next
      </div>

      {primaryAction && (
        <div
          data-primary-action="true"
          className={`rounded-lg border p-3 ${PRIORITY_STYLES[primaryAction.priority] ?? PRIORITY_STYLES.normal}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{primaryAction.label}</span>
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase">
              {primaryAction.priority}
            </span>
          </div>
          <div className="mt-1 text-xs opacity-80">{primaryAction.description}</div>
        </div>
      )}

      {nextActions.length > 1 && (
        <ul className="space-y-1.5">
          {nextActions.slice(1).map((action) => (
            <li key={action.code} className="flex items-start gap-2 text-xs text-neutral-700">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
              <div>
                <span className="font-medium">{action.label}</span>
                <span className="text-neutral-500"> — {action.description}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
