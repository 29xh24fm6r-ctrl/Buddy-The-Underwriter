"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import SnapshotBanner from "./SnapshotBanner";
import DriftBanner from "./DriftBanner";
import WorkstreamCard from "./WorkstreamCard";
import { OmegaAdvisoryBadge } from "@/components/deals/shared/OmegaAdvisoryBadge";
import type { OmegaAdvisoryState } from "@/core/omega/types";
import type { DriftSummary, SpreadSeedPackage, MemoSeedPackage } from "@/lib/underwritingLaunch/types";
import type { TrustLayerState } from "./UnderwriteTrustLayer";
import UnderwritingPipelineRail from "./UnderwritingPipelineRail";
import { QuickLookBanner } from "@/components/deals/quickLook/QuickLookBanner";
import { QuickLookQuestionsPanel } from "@/components/deals/quickLook/QuickLookQuestionsPanel";
import ResearchGateActionPanel, {
  CommitteeReadinessPanel,
  shouldShowCommitteeReadiness,
} from "./ResearchGateActionPanel";
import type { ResearchGateSnapshot, ResearchGatePending } from "./researchGateTypes";
import { fetchResearchGateSnapshot } from "./fetchResearchGateSnapshot";

interface WorkbenchState {
  deal: { id: string; dealName: string; borrowerLegalName: string; bankName: string; lifecycleStage: string; dealMode: "quick_look" | "full_underwrite"; isQuickLook: boolean };
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
  const [omegaState, setOmegaState] = useState<OmegaAdvisoryState | null>(null);

  // Research quality gate state (SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1)
  const [research, setResearch] = useState<ResearchGateSnapshot | null>(null);
  const [pending, setPending] = useState<ResearchGatePending>(null);
  const pendingRef = useRef<ResearchGatePending>(null);
  pendingRef.current = pending;

  useEffect(() => {
    fetch(`/api/deals/${dealId}/state`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.omega) setOmegaState(d.omega); })
      .catch(() => {});
  }, [dealId]);

  const fetchState = useCallback(async () => {
    try {
      const resp = await fetch(`/api/deals/${dealId}/underwrite/state`);
      const data = await resp.json();
      if (data.ok) setState(data);
    } catch {
      // silent
    }
  }, [dealId]);

  const fetchResearch = useCallback(async () => {
    const snap = await fetchResearchGateSnapshot(dealId);
    setResearch(snap);
  }, [dealId]);

  // Initial load: settle both workbench state and research gate before rendering
  // so the empty state can be blocker-aware on first paint (no generic flash).
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([fetchState(), fetchResearch()]).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fetchState, fetchResearch]);

  // Poll while a mission initiated elsewhere is queued/running. When the run is
  // driven by this client (pending === "run"), the awaited POST handles refresh.
  const missionStatus = research?.missionStatus ?? null;
  const gatePassed = research?.gatePassed ?? false;
  useEffect(() => {
    if (gatePassed) return;
    if (pendingRef.current === "run") return;
    if (missionStatus !== "queued" && missionStatus !== "running") return;
    const id = setInterval(() => { fetchResearch(); }, 8000);
    return () => clearInterval(id);
  }, [missionStatus, gatePassed, fetchResearch]);

  const initializeWorkbench = useCallback(async () => {
    setPending("init");
    try {
      await fetch(`/api/deals/${dealId}/underwrite/launch`, { method: "POST" });
    } catch {
      // surfaced via refreshed state below
    } finally {
      await Promise.allSettled([fetchState(), fetchResearch()]);
      setPending(null);
    }
  }, [dealId, fetchState, fetchResearch]);

  const runResearch = useCallback(async () => {
    setPending("run");
    try {
      // runMission completes synchronously server-side (up to ~5 min).
      await fetch(`/api/deals/${dealId}/research/run`, { method: "POST" });
    } catch {
      // surfaced via refreshed research snapshot below
    } finally {
      await Promise.allSettled([fetchResearch(), fetchState()]);
      setPending(null);
    }
  }, [dealId, fetchState, fetchResearch]);

  const updateWorkstream = async (field: string, status: string) => {
    await fetch(`/api/deals/${dealId}/underwrite/workspace`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: status }),
    });
    fetchState();
  };


  if (loading) return <div className="animate-pulse h-64 bg-white/5 rounded-xl" />;

  const workspaceReady = !!(state?.workspace && state?.activeSnapshot);
  const researchGateActive = !!research && !research.gatePassed;

  if (!workspaceReady) {
    // Blocker-aware empty state: when the active memo blocker is the research
    // quality gate, explain the dependency chain (workbench → research mission)
    // instead of dead-ending at a bare "workspace not initialized" prompt.
    if (researchGateActive && research) {
      return (
        <ResearchGateActionPanel
          snapshot={research}
          workspaceReady={false}
          pending={pending}
          onInitialize={initializeWorkbench}
          onRunResearch={runResearch}
        />
      );
    }

    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center space-y-4">
        <p className="text-sm text-white/60">
          Underwriting workspace not yet initialized for this deal.
        </p>
        <button
          onClick={initializeWorkbench}
          disabled={pending === "init"}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
        >
          {pending === "init" ? "Initializing…" : "Initialize Underwriting Workbench"}
        </button>
      </div>
    );
  }

  // workspaceReady guarantees both are present; re-narrow for the type checker.
  if (!state?.workspace || !state.activeSnapshot) return null;
  const { deal, workspace, activeSnapshot, drift, spreadSeed, memoSeed } = state;
  const isQuickLook = deal.isQuickLook ?? false;
  const snapshotLabel = `Snapshot ${activeSnapshot.launchSequence}`;
  const hasDrift = drift?.hasDrift ?? false;
  const isMaterialDrift = drift?.severity === "material";
  const spreadStale = hasDrift && drift!.items.some((i) => i.impact === "spreads" || i.impact === "all_underwriting");
  const memoStale = hasDrift && drift!.items.some((i) => i.impact === "memo" || i.impact === "all_underwriting");

  return (
    <div className="space-y-4">
      {/* Quick Look Banner */}
      {isQuickLook && <QuickLookBanner dealId={dealId} onUpgraded={fetchState} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">{deal.dealName}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-white/60">
            <span>{deal.borrowerLegalName}</span>
            <span className="text-white/30">{deal.bankName}</span>
            <span className="capitalize text-white/40">{deal.lifecycleStage?.replace(/_/g, " ")}</span>
          </div>
        </div>
        {omegaState && <OmegaAdvisoryBadge omega={omegaState} compact />}
      </div>

      {/* Research Quality Gate — active memo blocker (SPEC-…-RESEARCH-GATE-…-1) */}
      {researchGateActive && research && (
        <ResearchGateActionPanel
          snapshot={research}
          workspaceReady
          pending={pending}
          onInitialize={initializeWorkbench}
          onRunResearch={runResearch}
        />
      )}

      {/* SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1:
          gate passed (preliminary cleared) but committee still blocked — show the
          non-blocking committee path so the banker can act on the blockers. */}
      {!researchGateActive && research && shouldShowCommitteeReadiness(research) && (
        <CommitteeReadinessPanel snapshot={research} />
      )}

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

      {/* Pipeline Rail */}
      <UnderwritingPipelineRail dealId={dealId} onMemoGenerated={fetchState} />

      {/* Quick Look Questions */}
      {isQuickLook && <QuickLookQuestionsPanel dealId={dealId} />}

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
