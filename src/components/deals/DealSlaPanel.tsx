"use client";

/**
 * Phase 65G — Deal SLA Panel
 *
 * Detailed timing panel showing stage age, action age, campaign status,
 * and overdue items. Fetches from /tempo API.
 */

import { useState, useEffect } from "react";
import { DealTempoBadge } from "./DealTempoBadge";
import type { DealUrgencyBucket } from "@/core/sla/types";

type TempoSnapshot = {
  canonicalStage: string;
  stageAgeHours: number;
  primaryActionCode: string | null;
  primaryActionAgeHours: number | null;
  borrowerCampaignsOpen: number;
  borrowerCampaignsOverdue: number;
  criticalItemsOverdue: number;
  bankerTasksStale: number;
  isStageOverdue: boolean;
  isPrimaryActionStale: boolean;
  isDealStuck: boolean;
  urgencyScore: number;
  urgencyBucket: DealUrgencyBucket;
};

export function DealSlaPanel({ dealId }: { dealId: string }) {
  const [snapshot, setSnapshot] = useState<TempoSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchTempo() {
      try {
        const res = await fetch(`/api/deals/${dealId}/tempo`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setSnapshot(json.snapshot);
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTempo();
    return () => { cancelled = true; };
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="animate-pulse h-24 bg-neutral-100 rounded" />
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <section
      data-testid="deal-sla-panel"
      className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          SLA & Tempo
        </span>
        <DealTempoBadge bucket={snapshot.urgencyBucket} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetricRow label="Stage" value={formatStage(snapshot.canonicalStage)} />
        <MetricRow label="Stage age" value={`${snapshot.stageAgeHours}h`} warn={snapshot.isStageOverdue} />
        {snapshot.primaryActionCode && (
          <>
            <MetricRow label="Primary action" value={formatAction(snapshot.primaryActionCode)} />
            <MetricRow
              label="Action age"
              value={snapshot.primaryActionAgeHours !== null ? `${snapshot.primaryActionAgeHours}h` : "-"}
              warn={snapshot.isPrimaryActionStale}
            />
          </>
        )}
        <MetricRow label="Open campaigns" value={String(snapshot.borrowerCampaignsOpen)} />
        <MetricRow label="Overdue campaigns" value={String(snapshot.borrowerCampaignsOverdue)} warn={snapshot.borrowerCampaignsOverdue > 0} />
        <MetricRow label="Critical items overdue" value={String(snapshot.criticalItemsOverdue)} warn={snapshot.criticalItemsOverdue > 0} />
        <MetricRow label="Stale banker tasks" value={String(snapshot.bankerTasksStale)} warn={snapshot.bankerTasksStale > 0} />
      </div>

      <div className="text-[10px] text-neutral-400">
        Urgency score: {snapshot.urgencyScore}
      </div>
    </section>
  );
}

function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className={warn ? "font-semibold text-red-600" : "text-neutral-800"}>{value}</span>
    </div>
  );
}

function formatStage(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()); }
function formatAction(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()); }
