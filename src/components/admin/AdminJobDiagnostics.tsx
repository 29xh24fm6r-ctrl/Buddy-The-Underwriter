"use client";

import { useEffect, useState } from "react";

type DiagnosticsDeal = {
  deal_id: string;
  latest_event: string;
  latest_state: string;
  latest_message: string;
  last_updated_at: string;
  minutes_since_update: number;
  is_stuck: boolean;
};

type DiagnosticsData = {
  metrics: {
    in_flight: number;
    stuck: number;
    completed: number;
    total_deals: number;
  };
  deals: DiagnosticsDeal[];
};

/**
 * 🔍 Admin Job Diagnostics
 * 
 * Shows pipeline health across all deals.
 * Highlights stuck jobs (working >10min) for investigation.
 * 
 * Usage:
 * <AdminJobDiagnostics />
 */
export function AdminJobDiagnostics() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [replayingDeal, setReplayingDeal] = useState<string | null>(null);

  const fetchDiagnostics = async () => {
    try {
      setError(null);

      const res = await fetch("/api/admin/pipeline/diagnostics", {
        cache: "no-store",
      });

      const json = await res.json();

      if (!json.ok) {
        throw new Error(json.error || "Failed to fetch diagnostics");
      }

      setData(json);
    } catch (e: any) {
      console.error("[AdminJobDiagnostics] Error:", e);
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDiagnostics();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      void fetchDiagnostics();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="text-sm text-gray-600">Loading diagnostics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <div className="text-sm text-red-700">Error: {error}</div>
        <button
          onClick={() => void fetchDiagnostics()}
          className="mt-3 text-xs text-red-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { metrics, deals } = data;

  const stuckDeals = deals.filter((d) => d.is_stuck);
  const inFlightDeals = deals.filter((d) => d.latest_state === "working");
  const waitingDeals = deals.filter((d) => d.latest_state === "waiting");
  const doneDeals = deals.filter((d) => d.latest_state === "done");

  const getStateColor = (state: string) => {
    if (state === "working") return "text-blue-600 bg-blue-50";
    if (state === "waiting") return "text-amber-600 bg-amber-50";
    if (state === "done") return "text-green-600 bg-green-50";
    return "text-gray-600 bg-gray-50";
  };

  const replayEvent = async (dealId: string, eventKey: string) => {
    if (!confirm(`Replay event "${eventKey}" for deal ${dealId}?\n\nThis will re-emit the event with a new timestamp for UI testing.`)) {
      return;
    }

    try {
      setReplayingDeal(dealId);

      const res = await fetch("/api/admin/pipeline/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, event_key: eventKey }),
      });

      const json = await res.json();

      if (!json.ok) {
        throw new Error(json.error || "Failed to replay event");
      }

      alert(`Event replayed! UI should update within 2-15 seconds.`);
      
      // Refresh diagnostics to show new event
      void fetchDiagnostics();
    } catch (e: any) {
      alert(`Failed to replay: ${e.message}`);
    } finally {
      setReplayingDeal(null);
    }
  };

  const DealRow = ({ deal }: { deal: DiagnosticsDeal }) => (
    <tr className={deal.is_stuck ? "bg-red-50" : ""}>
      <td className="px-4 py-3 text-sm">
        {deal.is_stuck && <span className="mr-2 text-red-500">🔴</span>}
        <a
          href={`/deals/${deal.deal_id}/command`}
          className="font-mono text-xs text-blue-600 hover:underline"
        >
          {deal.deal_id.slice(0, 12)}...
        </a>
      </td>
      <td className="px-4 py-3 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStateColor(deal.latest_state)}`}>
          {deal.latest_state}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-600">{deal.latest_event}</td>
      <td className="px-4 py-3 text-xs text-gray-700">{deal.latest_message}</td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {deal.minutes_since_update}m ago
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => replayEvent(deal.deal_id, deal.latest_event)}
          disabled={replayingDeal === deal.deal_id}
          className="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200 disabled:opacity-50"
        >
          {replayingDeal === deal.deal_id ? "..." : "Replay"}
        </button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{metrics.total_deals}</div>
          <div className="text-xs text-gray-600">Total Deals</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-2xl font-bold text-blue-900">{metrics.in_flight}</div>
          <div className="text-xs text-blue-700">In Flight</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-2xl font-bold text-red-900">{metrics.stuck}</div>
          <div className="text-xs text-red-700">Stuck (&gt;10m)</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-2xl font-bold text-green-900">{metrics.completed}</div>
          <div className="text-xs text-green-700">Completed</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Pipeline Jobs</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>
          <button
            onClick={() => void fetchDiagnostics()}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Stuck Deals Alert */}
      {stuckDeals.length > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚨</span>
            <div>
              <div className="font-semibold text-red-900">
                {stuckDeals.length} stuck job{stuckDeals.length > 1 ? "s" : ""} detected
              </div>
              <div className="text-sm text-red-700">
                Jobs in "working" state for &gt;10 minutes may require investigation
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deals Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                Deal ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                Latest Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                Message
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                Last Update
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {/* Stuck first */}
            {stuckDeals.map((deal) => (
              <DealRow key={deal.deal_id} deal={deal} />
            ))}
            {/* Then in-flight */}
            {inFlightDeals.filter((d) => !d.is_stuck).map((deal) => (
              <DealRow key={deal.deal_id} deal={deal} />
            ))}
            {/* Then waiting */}
            {waitingDeals.map((deal) => (
              <DealRow key={deal.deal_id} deal={deal} />
            ))}
            {/* Then done */}
            {doneDeals.slice(0, 10).map((deal) => (
              <DealRow key={deal.deal_id} deal={deal} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
