"use client";

import Link from "next/link";
import { useState } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { StatusListPanel } from "../_shared/StatusListPanel";

/**
 * Committee package panel — surfaces packet readiness from the cockpit's
 * lifecycle state and exposes a one-click generate action.
 *
 * Reads `committeePacketReady` and `committeeRequired` from
 * lifecycleState.derived (no extra fetch needed).
 */
export function CommitteePackagePanel({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const derived = lifecycleState?.derived;

  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/committee/packet/generate`,
        { method: "POST" },
      );
      if (!res.ok) {
        setFeedback(`Failed (${res.status}). Open the committee studio to retry.`);
      } else {
        setFeedback("Packet generation started. Refresh the page in a moment to see the result.");
      }
    } catch (err) {
      setFeedback(`Failed: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

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
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/20 disabled:opacity-60"
            data-testid="committee-package-generate"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            {generating
              ? "Generating…"
              : ready
                ? "Regenerate Packet"
                : "Generate Packet"}
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
      {feedback ? (
        <div className="mt-2 rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/70">
          {feedback}
        </div>
      ) : null}
    </StatusListPanel>
  );
}
