"use client";

import { useEffect, useState } from "react";
import { useDealRealtimeRefresh } from "@/hooks/useDealRealtimeRefresh";

type Condition = {
  id: string;
  deal_id: string;
  rule_id: string;
  name: string;
  satisfied: boolean;
  reasons: string[];
  created_at: string;
  updated_at: string;
  evidence?: { evidence_key: string; satisfied_reason?: string }[];
};

interface ConditionsCardProps {
  dealId: string;
  className?: string;
}

export function ConditionsCard({ dealId, className = "" }: ConditionsCardProps) {
  const { refreshKey } = useDealRealtimeRefresh(dealId);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) return;
    setLoading(true);
    fetch(`/api/deals/${dealId}/conditions`)
      .then((r) => r.json())
      .then((data) => {
        setConditions(data?.conditions ?? []);
      })
      .catch((e) => {
        console.error("[ConditionsCard] fetch error:", e);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dealId, refreshKey]);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const resp = await fetch(`/api/deals/${dealId}/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: "TERM", hasRealEstateCollateral: false, isSba: false, presentDocKeys: [] }),
      });
      if (!resp.ok) throw new Error("Recompute failed");
      const result = await resp.json();
      console.log("[ConditionsCard] recompute result:", result);
      // Refresh triggered by realtime subscription
    } catch (e: any) {
      console.error("[ConditionsCard] recompute error:", e);
      setError("Recompute failed: " + (e?.message || "unknown"));
    } finally {
      setRecomputing(false);
    }
  };

  const openConditions = conditions.filter((c) => !c.satisfied);
  const satisfiedConditions = conditions.filter((c) => c.satisfied);

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow ${className}`}>
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Conditions</h3>
        <button
          type="button"
          onClick={handleRecompute}
          disabled={recomputing}
          className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {recomputing ? "Recomputing..." : "Recompute"}
        </button>
      </div>

      {error ? (
        <div className="mx-4 mt-4 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {error}
        </div>
      ) : null}

      <div className="p-4 space-y-4">
        {/* Open conditions */}
        {openConditions.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
              Open ({openConditions.length})
            </h4>
            <div className="space-y-2">
              {openConditions.map((cond) => (
                <div key={cond.id} className="border border-red-300 dark:border-red-700 rounded p-3 bg-red-50 dark:bg-red-900/20">
                  <div className="font-medium text-gray-900 dark:text-white">{cond.name}</div>
                  {cond.reasons.length > 0 && (
                    <ul className="mt-1 text-sm text-gray-700 dark:text-gray-300 list-disc list-inside">
                      {cond.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {cond.evidence && cond.evidence.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                      Evidence: {cond.evidence.map((e) => e.evidence_key).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-green-600 dark:text-green-400 text-sm font-medium">✓ No open conditions</div>
        )}

        {/* Satisfied conditions */}
        {satisfiedConditions.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-2">
              Satisfied ({satisfiedConditions.length})
            </h4>
            <div className="space-y-2">
              {satisfiedConditions.map((cond) => (
                <div key={cond.id} className="border border-green-300 dark:border-green-700 rounded p-3 bg-green-50 dark:bg-green-900/20">
                  <div className="font-medium text-gray-900 dark:text-white">{cond.name}</div>
                  {cond.evidence && cond.evidence.length > 0 && (
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Evidence: {cond.evidence.map((e) => e.evidence_key).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {conditions.length === 0 && (
          <div className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
            No conditions evaluated yet. Click Recompute to trigger evaluation.
          </div>
        )}
      </div>
    </div>
  );
}
