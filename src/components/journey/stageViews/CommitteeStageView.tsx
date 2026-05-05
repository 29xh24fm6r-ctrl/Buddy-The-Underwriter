"use client";

import { useCallback, useEffect, useState } from "react";
import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { CreditMemoPanel, type MemoSummary } from "./committee/CreditMemoPanel";
import { MemoReconciliationPanel } from "./committee/MemoReconciliationPanel";
import { CommitteePackagePanel } from "./committee/CommitteePackagePanel";
import { ApprovalReadinessPanel } from "./committee/ApprovalReadinessPanel";
import { useRegisterStageRefresher } from "./_shared/useStageDataRefresh";

export function CommitteeStageView({
  dealId,
  state,
  action,
  isAdmin = false,
}: {
  dealId: string;
  state: LifecycleState | null;
  action: NextAction | null;
  isAdmin?: boolean;
}) {
  const stage = state?.stage ?? null;
  const blockers = state?.blockers ?? [];

  return (
    <StageWorkspaceShell
      stage={stage}
      dealId={dealId}
      action={action}
      blockers={blockers}
      subtitle="Review the memo, reconcile gaps, and prepare the committee packet — all in cockpit."
      advanced={
        <AdvancedDisclosure>
          <SafeBoundary>
            <DealStoryTimeline dealId={dealId} />
          </SafeBoundary>
          {isAdmin ? (
            <SafeBoundary>
              <ForceAdvancePanel dealId={dealId} currentStage={stage} />
            </SafeBoundary>
          ) : null}
        </AdvancedDisclosure>
      }
    >
      <CommitteeStageBody dealId={dealId} isAdmin={isAdmin} />
    </StageWorkspaceShell>
  );
}

/**
 * Body is split out so it can sit *inside* StageDataProvider (which
 * StageWorkspaceShell mounts) and register a refresher with it.
 *
 * Owns the single fetch of memo readiness for both memo panels.
 */
function CommitteeStageBody({
  dealId,
  isAdmin,
}: {
  dealId: string;
  isAdmin: boolean;
}) {
  const [memoSummary, setMemoSummary] = useState<MemoSummary | null>(null);
  const [memoLoading, setMemoLoading] = useState(true);
  const [memoError, setMemoError] = useState<string | null>(null);

  const fetchMemoSummary = useCallback(async () => {
    setMemoLoading(true);
    setMemoError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/credit-memo/canonical/missing`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as MemoSummary;
      setMemoSummary(json);
    } catch (err) {
      setMemoError((err as Error).message ?? "fetch_failed");
    } finally {
      setMemoLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void fetchMemoSummary();
  }, [fetchMemoSummary]);

  // Register the memo refresher so cockpit actions trigger a re-fetch.
  useRegisterStageRefresher("committee:memo-summary", fetchMemoSummary);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-4 lg:col-span-8">
        <SafeBoundary>
          <CreditMemoPanel
            dealId={dealId}
            memoSummary={memoSummary}
            loading={memoLoading}
            error={memoError}
          />
        </SafeBoundary>
        <SafeBoundary>
          <MemoReconciliationPanel
            dealId={dealId}
            memoSummary={memoSummary}
            loading={memoLoading}
            error={memoError}
          />
        </SafeBoundary>
        <SafeBoundary>
          <CommitteePackagePanel dealId={dealId} />
        </SafeBoundary>
        <SafeBoundary>
          <ApprovalReadinessPanel dealId={dealId} />
        </SafeBoundary>
      </div>
      <div className="space-y-4 lg:col-span-4">
        <SafeBoundary>
          <ReadinessPanel dealId={dealId} isAdmin={isAdmin} />
        </SafeBoundary>
      </div>
    </div>
  );
}
