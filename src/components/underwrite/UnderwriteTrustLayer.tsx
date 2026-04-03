"use client";

import MemoFreshnessCard from "./MemoFreshnessCard";
import PacketReadinessCard from "./PacketReadinessCard";
import FinancialValidationCard from "./FinancialValidationCard";

// ── Trust Layer Types (mirrors server TrustLayer) ─────────────────────────

export type TrustLayerState = {
  memo: {
    status: "fresh" | "stale" | "missing" | "failed";
    staleReasons: string[];
    lastGeneratedAt: string | null;
    inputHash: string | null;
    snapshotId: string | null;
  };
  packet: {
    status: "ready" | "warning" | "blocked" | "missing";
    warnings: string[];
    blockers: string[];
    lastGeneratedAt: string | null;
    financialValidationStatus: string | null;
    hasCanonicalMemoNarrative: boolean;
  };
  financialValidation: {
    memoSafe: boolean;
    decisionSafe: boolean;
    blockers: string[];
    warnings: string[];
    snapshotId: string | null;
  };
};

interface Props {
  dealId: string;
  trustLayer: TrustLayerState;
  onRegenerateMemo: () => void;
  onGeneratePacket: () => void;
  regeneratingMemo?: boolean;
  generatingPacket?: boolean;
}

/**
 * Derive a banker-facing recommended next action from trust layer state.
 * Uses the same priority logic as the canonical next-step engine:
 * financial validation → memo → packet, in that order.
 */
function deriveRecommendedAction(t: TrustLayerState): { text: string; href: string } | null {
  // Financial validation blockers are highest priority
  if (t.financialValidation.blockers.length > 0) {
    return { text: "Resolve financial validation issues before proceeding", href: "" };
  }
  // Memo must exist before packet
  if (t.memo.status === "missing") {
    return { text: "Generate the credit memo to unlock committee preparation", href: "" };
  }
  if (t.memo.status === "stale") {
    return { text: "Regenerate the credit memo — underlying data has changed", href: "" };
  }
  if (t.memo.status === "failed") {
    return { text: "Retry credit memo generation — previous attempt failed", href: "" };
  }
  // Packet readiness
  if (t.packet.status === "blocked") {
    return { text: "Resolve packet blockers before committee submission", href: "" };
  }
  if (t.packet.status === "missing" && t.memo.status === "fresh") {
    return { text: "Generate the committee packet for review", href: "" };
  }
  // Financial warnings (non-blocking)
  if (!t.financialValidation.decisionSafe && t.financialValidation.memoSafe) {
    return { text: "Review financial validation items to reach decision-safe status", href: "" };
  }
  return null;
}

export default function UnderwriteTrustLayer({
  dealId,
  trustLayer,
  onRegenerateMemo,
  onGeneratePacket,
  regeneratingMemo,
  generatingPacket,
}: Props) {
  const { memo, packet, financialValidation } = trustLayer;

  // All green + nothing to show → compact summary
  const allGreen =
    memo.status === "fresh" &&
    (packet.status === "ready" || packet.status === "missing") &&
    financialValidation.memoSafe &&
    financialValidation.decisionSafe;

  const recommendedAction = allGreen ? null : deriveRecommendedAction(trustLayer);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
        Trust Layer
      </h3>
      {allGreen ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            Memo fresh, financials validated, ready for committee
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendedAction && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2">
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <span className="font-semibold">Recommended:</span>
                {recommendedAction.text}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <MemoFreshnessCard
              dealId={dealId}
              status={memo.status}
              staleReasons={memo.staleReasons}
              lastGeneratedAt={memo.lastGeneratedAt}
              inputHash={memo.inputHash}
              onRegenerate={onRegenerateMemo}
              regenerating={regeneratingMemo}
            />
            <PacketReadinessCard
              dealId={dealId}
              status={packet.status}
              warnings={packet.warnings}
              blockers={packet.blockers}
              lastGeneratedAt={packet.lastGeneratedAt}
              financialValidationStatus={packet.financialValidationStatus}
              hasCanonicalMemoNarrative={packet.hasCanonicalMemoNarrative}
              onGeneratePacket={onGeneratePacket}
              generating={generatingPacket}
            />
            <FinancialValidationCard
              dealId={dealId}
              memoSafe={financialValidation.memoSafe}
              decisionSafe={financialValidation.decisionSafe}
              blockers={financialValidation.blockers}
              warnings={financialValidation.warnings}
              snapshotId={financialValidation.snapshotId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
