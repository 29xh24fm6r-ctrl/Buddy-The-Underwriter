"use client";

/**
 * Phase 65I — Post-Close Page Client
 *
 * Main client component for the deal post-close monitoring tab.
 * Fetches data from /api/deals/[dealId]/post-close and renders panels.
 */

import { useCallback, useEffect, useState } from "react";
import PostCloseProgramPanel from "./PostCloseProgramPanel";
import MonitoringCyclesTable from "./MonitoringCyclesTable";
import MonitoringExceptionsPanel from "./MonitoringExceptionsPanel";
import type { MonitoringProgramSummary } from "@/core/post-close/types";

type Props = {
  dealId: string;
};

type PostCloseData = {
  program: MonitoringProgramSummary | null;
  obligations: Array<{
    id: string;
    title: string;
    obligationType: string;
    cadence: string;
    status: string;
  }>;
  cycles: Array<{
    id: string;
    obligationId: string;
    title: string;
    dueAt: string;
    status: string;
    severity: string;
    blockingParty: string;
    borrowerCampaignId: string | null;
  }>;
  exceptions: Array<{
    id: string;
    exceptionCode: string;
    severity: string;
    status: string;
    openedAt: string;
  }>;
  annualReview: { status: string; dueAt: string | null } | null;
  renewalPrep: { status: string; prepStartAt: string | null } | null;
};

export default function PostClosePageClient({ dealId }: Props) {
  const [data, setData] = useState<PostCloseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/post-close`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch (err) {
      console.error("[PostClose] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStartReview(cycleId: string) {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/post-close/cycles/${cycleId}/review-start`, {
        method: "POST",
      });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete(cycleId: string) {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/post-close/cycles/${cycleId}/complete`, {
        method: "POST",
      });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResolveException(exceptionId: string) {
    setActionLoading(true);
    try {
      await fetch(`/api/deals/${dealId}/post-close/exceptions/${exceptionId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-white/40 text-sm">Loading post-close monitoring...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-bold text-white/90">Post-Close Monitoring</h2>

      <PostCloseProgramPanel
        program={data?.program ?? null}
        annualReview={data?.annualReview ?? null}
        renewalPrep={data?.renewalPrep ?? null}
      />

      {data?.exceptions && data.exceptions.length > 0 && (
        <MonitoringExceptionsPanel
          exceptions={data.exceptions}
          onResolve={handleResolveException}
          loading={actionLoading}
        />
      )}

      <div>
        <h3 className="text-sm font-semibold text-white/70 mb-2">Monitoring Cycles</h3>
        <MonitoringCyclesTable
          cycles={data?.cycles ?? []}
          onStartReview={handleStartReview}
          onComplete={handleComplete}
          loading={actionLoading}
        />
      </div>

      {data?.obligations && data.obligations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-2">Obligations</h3>
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="glass-header">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase">Title</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-28">Type</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-24">Cadence</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-20">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.obligations.map((ob) => (
                  <tr key={ob.id} className="glass-row">
                    <td className="px-4 py-2 text-xs text-white/70">{ob.title}</td>
                    <td className="px-4 py-2 text-xs text-white/50">{ob.obligationType.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-xs text-white/50 capitalize">{ob.cadence.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-xs text-white/50 capitalize">{ob.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
