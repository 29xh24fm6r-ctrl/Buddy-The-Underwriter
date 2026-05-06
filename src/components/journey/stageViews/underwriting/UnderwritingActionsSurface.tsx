"use client";

import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitRunnableAction } from "../../actions/actionTypes";
import { ActionFeedback, OPTIMISTIC_MESSAGES } from "../_shared/ActionFeedback";

/**
 * SPEC-06 — exposes the runnable underwriting actions inline so a banker
 * can kick them off from the cockpit instead of bouncing to a deeper
 * surface. All actions flow through the SPEC-04 useCockpitAction runner,
 * meaning telemetry + scoped refresh + optimistic feedback are uniform.
 *
 * Today's catalog: refresh financial snapshot. Future actions slot in here
 * by adding to the `ACTIONS` array — no other rewires.
 */
type UnderwritingActionDef = {
  id: string;
  label: string;
  description: string;
  action: CockpitRunnableAction;
};

const ACTIONS: UnderwritingActionDef[] = [
  {
    id: "underwriting:refresh-snapshot",
    label: "Refresh financial snapshot",
    description: "Recompute the canonical snapshot from current spreads + facts.",
    action: {
      intent: "runnable",
      label: "Refresh snapshot",
      actionType: "generate_snapshot",
    },
  },
];

export function UnderwritingActionsSurface({ dealId }: { dealId: string }) {
  const { state, run } = useCockpitAction(dealId);

  return (
    <section
      data-testid="underwriting-actions-surface"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-blue-300 text-[20px]">
          play_circle
        </span>
        <h3 className="text-sm font-semibold text-white">Underwriting Actions</h3>
      </header>

      <ul className="space-y-2">
        {ACTIONS.map(({ id, label, description, action }) => {
          const isPending = state.status === "pending" && state.activeId === id;
          return (
            <li
              key={id}
              className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="text-sm text-white/90">{label}</div>
                <div className="text-[11px] text-white/50">{description}</div>
                <ActionFeedback
                  actionId={id}
                  state={state}
                  actionLabel={label}
                  optimisticMessage={OPTIMISTIC_MESSAGES[action.actionType]}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isPending) return;
                  void run(action, { id });
                }}
                disabled={isPending}
                aria-busy={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
                data-testid={`underwriting-action-${id}`}
              >
                {isPending ? "Running…" : label}
                <span className="material-symbols-outlined text-[14px]">
                  arrow_forward
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
