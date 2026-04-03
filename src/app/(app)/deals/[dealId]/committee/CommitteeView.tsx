"use client";
import { useEffect, useState } from "react";
import { OmegaAdvisoryBadge } from "@/components/deals/shared/OmegaAdvisoryBadge";
import { CanonicalStateBanner } from "@/components/deals/shared/CanonicalStateBanner";
import CommitteeDecisionPanel from "./CommitteeDecisionPanel";
import type { BuddyCanonicalState, SystemAction } from "@/core/state/types";
import type { OmegaAdvisoryState } from "@/core/omega/types";

type StateResponse = {
  ok: boolean;
  state: BuddyCanonicalState;
  omega: OmegaAdvisoryState;
  explanation: { summary: string; blockerText?: string };
  primaryAction: SystemAction;
};

type SnapshotInfo = { createdAt: string };

export function CommitteeView({ dealId, borrowerName, borrowerEntityType, snapshot }: {
  dealId: string; borrowerName: string; borrowerEntityType: string; snapshot?: SnapshotInfo | null;
}) {
  const [data, setData] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/state`)
      .then(r => r.json())
      .then((d: StateResponse) => { if (!d.ok) throw new Error("State fetch failed"); setData(d); })
      .catch(e => setError(e?.message ?? "Failed to load deal state"))
      .finally(() => setLoading(false));
  }, [dealId]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Committee Review</h1>
            <p className="text-sm text-gray-500">{borrowerName} &middot; {borrowerEntityType}</p>
          </div>
          {snapshot && (
            <div className="rounded-lg bg-blue-50 px-4 py-2">
              <div className="text-xs text-blue-600">Snapshot</div>
              <div className="text-sm font-medium text-blue-900">{new Date(snapshot.createdAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-6 p-6">
        {loading && <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading deal state&hellip;</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {data && (
          <>
            <CanonicalStateBanner action={data.primaryAction} variant="card" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="Stage" value={data.state.lifecycle.replace(/_/g, " ")} />
              <SummaryCard label="Committee" value={
                data.state.committeeState.complete
                  ? data.state.committeeState.outcome.replace(/_/g, " ")
                  : `${data.state.committeeState.voteCount} / ${data.state.committeeState.quorum} votes`
              } />
              <SummaryCard label="Exceptions" value={
                data.state.exceptionState.openCount === 0 ? "None open"
                : `${data.state.exceptionState.openCount} open${data.state.exceptionState.criticalCount > 0 ? ` \u00b7 ${data.state.exceptionState.criticalCount} critical` : ""}`
              } highlight={data.state.exceptionState.criticalCount > 0} />
              <SummaryCard label="Checklist" value={
                data.state.checklistReadiness.ready ? "Ready"
                : `${data.state.checklistReadiness.satisfiedItems} / ${data.state.checklistReadiness.totalItems}`
              } />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {data.explanation?.summary && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Buddy</div>
                  <p className="text-sm text-gray-700">{data.explanation.summary}</p>
                  {data.explanation.blockerText && <p className="mt-2 text-xs text-amber-700">{data.explanation.blockerText}</p>}
                </div>
              )}
              {data.omega && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Omega advisory</div>
                  <OmegaAdvisoryBadge omega={data.omega} />
                </div>
              )}
            </div>
            {data.state.blockers.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 text-sm font-semibold text-amber-900">Active blockers</div>
                <ul className="space-y-1">{data.state.blockers.map((b, i) => <li key={i} className="text-xs text-amber-800">&middot; {String(b)}</li>)}</ul>
              </div>
            )}
          </>
        )}
        <CommitteeDecisionPanel dealId={dealId} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold capitalize ${highlight ? "text-red-800" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}
