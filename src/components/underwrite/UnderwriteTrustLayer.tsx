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
  onViewProvenance: () => void;
  regeneratingMemo?: boolean;
  generatingPacket?: boolean;
}

export default function UnderwriteTrustLayer({
  trustLayer,
  onRegenerateMemo,
  onGeneratePacket,
  onViewProvenance,
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
        <div className="grid grid-cols-3 gap-3">
          <MemoFreshnessCard
            status={memo.status}
            staleReasons={memo.staleReasons}
            lastGeneratedAt={memo.lastGeneratedAt}
            inputHash={memo.inputHash}
            onRegenerate={onRegenerateMemo}
            regenerating={regeneratingMemo}
          />
          <PacketReadinessCard
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
            memoSafe={financialValidation.memoSafe}
            decisionSafe={financialValidation.decisionSafe}
            blockers={financialValidation.blockers}
            warnings={financialValidation.warnings}
            snapshotId={financialValidation.snapshotId}
            onViewProvenance={onViewProvenance}
          />
        </div>
      )}
    </div>
  );
}
