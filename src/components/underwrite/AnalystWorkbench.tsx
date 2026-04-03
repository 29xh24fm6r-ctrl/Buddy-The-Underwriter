"use client";

import { useState, useEffect, useCallback } from "react";
import SnapshotBanner from "./SnapshotBanner";
import DriftBanner from "./DriftBanner";
import WorkstreamCard from "./WorkstreamCard";
import type { DriftSummary, SpreadSeedPackage, MemoSeedPackage } from "@/lib/underwritingLaunch/types";
import UnderwriteTrustLayer, { type TrustLayerState } from "./UnderwriteTrustLayer";

interface WorkbenchState {
  deal: { id: string; dealName: string; borrowerLegalName: string; bankName: string; lifecycleStage: string };
  workspace: {
    id: string; status: string; spreadStatus: string; memoStatus: string; riskStatus: string;
    assignedAnalystId: string | null; refreshRequired: boolean; launchedAt: string; launchedBy: string;
  } | null;
  activeSnapshot: {
    id: string; launchSequence: number; launchedAt: string; launchedBy: string;
    analystHandoffNote?: string | null; canonicalLoanRequestId?: string | null; financialSnapshotId?: string | null;
  } | null;
  drift: DriftSummary | null;
  spreadSeed: SpreadSeedPackage | null;
  memoSeed: MemoSeedPackage | null;
  trustLayer: TrustLayerState | null;
}

interface Props {
  dealId: string;
}

export default function AnalystWorkbench({ dealId }: Props) {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [driftModalOpen, setDriftModalOpen] = useState(false);
  const [regeneratingMemo, setRegeneratingMemo] = useState(false);
  const [generatingPacket, setGeneratingPacket] = useState(false);

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/deals/${dealId}/underwrite/state`);
      const data = await resp.json();
      if (data.ok) setState(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { fetchState(); }, [fetchState]);

  const updateWorkstream = async (field: string, status: string) => {
    await fetch(`/api/deals/${dealId}/underwrite/workspace`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: status }),
    });
    fetchState();
  };

  const handleRegenerateMemo = async () => {
    setRegeneratingMemo(true);
    try {
      await fetch(`/api/deals/${dealId}/credit-memo/generate`, { method: "POST" });
      fetchState();
    } catch { /* silent */ } finally {
      setRegeneratingMemo(false);
    }
  };

  const handleGeneratePacket = async () => {
    setGeneratingPacket(true);
    try {
      await fetch(`/api/deals/${dealId}/committee/packet/generate`, { method: "POST" });
      fetchState();
    } catch { /* silent */ } finally {
      setGeneratingPacket(false);
    }
  };

  const handleViewProvenance = () => {
    // Navigate to financial provenance within the deal's existing surfaces
    window.location.href = `/deals/${dealId}/spreads/standard`;
  };

  if (loading) return <div className="animate-pulse h-64 bg-white/5 rounded-xl" />;

  if (!state?.workspace || !state.activeSnapshot) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-sm text-white/50">Underwriting has not been launched for this deal.</p>
        <p className="text-xs text-white/30 mt-1">Return to Cockpit to launch underwriting.</p>
      </div>
    );
  }

  const { deal, workspace, activeSnapshot, drift, spreadSeed, memoSeed } = state;
  const snapshotLabel = `Snapshot ${activeSnapshot.launchSequence}`;
  const hasDrift = drift?.hasDrift ?? false;
  const isMaterialDrift = drift?.severity === "material";
  const spreadStale = hasDrift && drift!.items.some((i) => i.impact === "spreads" || i.impact === "all_underwriting");
  const memoStale = hasDrift && drift!.items.some((i) => i.impact === "memo" || i.impact === "all_underwriting");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-white">{deal.dealName}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-white/60">
          <span>{deal.borrowerLegalName}</span>
          <span className="text-white/30">{deal.bankName}</span>
          <span className="capitalize text-white/40">{deal.lifecycleStage?.replace(/_/g, " ")}</span>
        </div>
      </div>

      {/* Snapshot Banner */}
      <SnapshotBanner
        snapshotId={activeSnapshot.id}
        launchSequence={activeSnapshot.launchSequence}
        launchedAt={activeSnapshot.launchedAt}
        launchedBy={activeSnapshot.launchedBy}
        handoffNote={activeSnapshot.analystHandoffNote}
        canonicalLoanRequestId={activeSnapshot.canonicalLoanRequestId}
        financialSnapshotId={activeSnapshot.financialSnapshotId}
      />

      {/* Drift Banner */}
      {drift && drift.hasDrift && (
        <DriftBanner
          drift={drift}
          onReviewDrift={() => setDriftModalOpen(true)}
          onRefresh={() => {
            fetch(`/api/deals/${dealId}/underwriting/refresh`, { method: "POST" })
              .then(() => fetchState());
          }}
        />
      )}

      {/* Trust Layer */}
      {state.trustLayer && (
        <UnderwriteTrustLayer
          dealId={dealId}
          trustLayer={state.trustLayer}
          onRegenerateMemo={handleRegenerateMemo}
          onGeneratePacket={handleGeneratePacket}
          onViewProvenance={handleViewProvenance}
          regeneratingMemo={regeneratingMemo}
          generatingPacket={generatingPacket}
        />
      )}

      {/* Workstream Cards */}
      <div className="grid grid-cols-3 gap-4">
        <WorkstreamCard
          title="Spreads"
          status={workspace.spreadStatus}
          snapshotId={activeSnapshot.id}
          snapshotLabel={snapshotLabel}
          isStale={spreadStale}
          primaryCta={workspace.spreadStatus === "not_started" ? "Start Spreads" : "Continue Spreads"}
          onPrimaryAction={() => updateWorkstream("spreadStatus", "in_progress")}
        >
          {spreadSeed && (
            <div className="space-y-0.5 text-xs text-white/50">
              {spreadSeed.financialPeriodSummary.businessTaxReturnYears.length > 0 && (
                <div>BTR: {spreadSeed.financialPeriodSummary.businessTaxReturnYears.join(", ")}</div>
              )}
              {spreadSeed.financialPeriodSummary.hasYtdIncomeStatement && <div>YTD Income Statement</div>}
              {spreadSeed.financialPeriodSummary.hasCurrentBalanceSheet && <div>Current Balance Sheet</div>}
            </div>
          )}
        </WorkstreamCard>

        <WorkstreamCard
          title="Credit Memo"
          status={workspace.memoStatus}
          snapshotId={activeSnapshot.id}
          snapshotLabel={snapshotLabel}
          isStale={memoStale}
          primaryCta={workspace.memoStatus === "not_started" ? "Start Memo" : "Continue Memo"}
          onPrimaryAction={() => updateWorkstream("memoStatus", "in_progress")}
        >
          {memoSeed && (
            <div className="space-y-0.5 text-xs text-white/50">
              <div>{memoSeed.request.loanType ?? "—"} · ${memoSeed.request.loanAmount?.toLocaleString() ?? "—"}</div>
              <div>{memoSeed.request.facilityPurpose?.replace(/_/g, " ") ?? "—"}</div>
            </div>
          )}
        </WorkstreamCard>

        <WorkstreamCard
          title="Risk & Structure"
          status={workspace.riskStatus}
          snapshotId={activeSnapshot.id}
          snapshotLabel={snapshotLabel}
          isStale={isMaterialDrift}
          primaryCta={workspace.riskStatus === "not_started" ? "Open Risk Notes" : "Continue Risk Review"}
          onPrimaryAction={() => updateWorkstream("riskStatus", "in_progress")}
        />
      </div>
    </div>
  );
}
