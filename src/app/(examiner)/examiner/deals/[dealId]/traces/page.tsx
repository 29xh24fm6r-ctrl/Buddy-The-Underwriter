/**
 * Examiner Traces View — read-only omega traces.
 *
 * Shows signal ledger entries for the deal within grant scope.
 * Grant-scoped, all access logged.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type SignalEntry = {
  id: string;
  created_at: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
};

export default function ExaminerTracesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = (params?.dealId as string) ?? "";
  const grantId = searchParams?.get("grant_id") ?? "";

  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId || !grantId) {
      setError("Missing deal_id or grant_id.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Use the portal deal endpoint which includes snapshot with signals
        const res = await fetch(
          `/api/examiner/portal/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`,
        );
        const json = await res.json();
        if (json.ok) {
          // Extract signals from snapshot if available
          const snap = json.snapshot;
          setSignals(
            Array.isArray(snap?.signals) ? snap.signals : [],
          );
        } else {
          setError(json.error?.message ?? "Failed to load traces.");
        }
      } catch {
        setError("Unable to load traces.");
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId, grantId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Loading traces...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-sm font-medium text-red-800 mb-1">Error</div>
        <div className="text-xs text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Signal Traces</h2>
        <span className="text-[10px] text-gray-400">
          {signals.length} signal{signals.length !== 1 ? "s" : ""}
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-xs text-gray-500">
          No signals found for this deal.
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="bg-white border border-gray-200 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-800">
                  {signal.type}
                </span>
                <span className="text-[10px] text-gray-400">
                  {new Date(signal.created_at).toLocaleString()}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mb-1">
                Source: {signal.source}
              </div>
              {signal.payload && Object.keys(signal.payload).length > 0 && (
                <pre className="text-[10px] font-mono text-gray-600 bg-gray-50 p-2 rounded max-h-24 overflow-y-auto">
                  {JSON.stringify(signal.payload, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      <a
        href={`/examiner/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`}
        className="text-xs text-blue-600 hover:text-blue-800 inline-block"
      >
        ← Back to deal
      </a>
    </div>
  );
}
