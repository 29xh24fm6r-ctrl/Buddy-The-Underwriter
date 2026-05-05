"use client";

import Link from "next/link";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitRunnableAction } from "../../actions/actionTypes";
import { StatusListPanel } from "../_shared/StatusListPanel";

/**
 * Committee package panel.
 *
 * SPEC-04: packet generation now flows through the shared action runner
 * (intent=runnable, actionType=generate_packet). The panel does NOT POST
 * to the packet-generate endpoint directly — that removes split-brain
 * behavior with PrimaryActionBar.
 */
export function CommitteePackagePanel({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const { state, run } = useCockpitAction(dealId);
  const derived = lifecycleState?.derived;

  const required = derived?.committeeRequired ?? false;
  const ready = derived?.committeePacketReady ?? false;

  const status = !lifecycleState
    ? "PENDING"
    : !required
      ? "NOT REQUIRED"
      : ready
        ? "READY"
        : "MISSING";

  const tone = !required ? "neutral" : ready ? "success" : "warn";

  const ACTION_ID = "committee-package:generate";
  const isPending = state.status === "pending" && state.activeId === ACTION_ID;
  const isFailed = state.status === "error" && state.activeId === ACTION_ID;
  const succeeded = state.status === "success" && state.activeId === ACTION_ID;

  const action: CockpitRunnableAction = {
    intent: "runnable",
    label: ready ? "Regenerate Packet" : "Generate Packet",
    actionType: "generate_packet",
  };

  return (
    <StatusListPanel
      testId="committee-package-panel"
      title="Committee Package"
      icon="folder_zip"
      badge={status}
      badgeTone={tone}
      summary={
        !required
          ? "This deal does not require a committee packet."
          : ready
            ? "Packet has been generated and is ready for committee."
            : "Packet has not been generated. Generate before sending to committee."
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {required ? (
          <button
            type="button"
            onClick={() => {
              if (isPending) return;
              void run(action, { id: ACTION_ID });
            }}
            disabled={isPending}
            aria-busy={isPending}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
            data-testid="committee-package-generate"
          >
            <span
              className={`material-symbols-outlined text-[14px] ${
                isPending ? "animate-spin" : ""
              }`}
            >
              {isPending ? "progress_activity" : "refresh"}
            </span>
            {isPending ? "Generating…" : action.label}
          </button>
        ) : null}
        <Link
          href={`/deals/${dealId}/committee-studio`}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/10"
        >
          Committee Studio
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
      {isFailed && state.errorMessage ? (
        <div
          className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200"
          role="alert"
        >
          Packet generation failed: {state.errorMessage}
        </div>
      ) : null}
      {succeeded ? (
        <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-200">
          Packet generation started. The page is refreshing now.
        </div>
      ) : null}
    </StatusListPanel>
  );
}
