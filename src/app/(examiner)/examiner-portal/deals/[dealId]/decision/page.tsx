/**
 * Examiner Decision View — read-only decision data.
 *
 * Shows decision snapshot from the examiner portal API.
 * Includes omega state if available.
 * Grant-scoped, all access logged.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

export default function ExaminerDecisionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = (params?.dealId as string) ?? "";
  const grantId = searchParams?.get("grant_id") ?? "";

  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [omegaState, setOmegaState] = useState<Record<string, unknown> | null>(null);
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
        const res = await fetch(
          `/api/examiner/portal/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`,
        );
        const json = await res.json();
        if (json.ok) {
          setSnapshot(json.snapshot);
          setOmegaState(json.omega_state ?? null);
        } else {
          setError(json.error?.message ?? "Failed to load decision data.");
        }
      } catch {
        setError("Unable to load decision data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId, grantId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Loading decision data...
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

  const deal = (snapshot?.deal ?? {}) as Record<string, unknown>;
  const decision = (deal.decision_json ?? deal.credit_decision ?? null) as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Decision Data</h2>
        <span className="text-[10px] text-gray-400">Read-Only</span>
      </div>

      {/* Decision Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-3">Decision Summary</div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">Status</span>
            <span className="text-gray-800">
              {String(deal.lifecycle_phase ?? deal.status ?? "—")}
            </span>
          </div>
          {deal.confidence_score != null && (
            <div className="flex justify-between">
              <span className="text-gray-400">Confidence Score</span>
              <span className="text-gray-800 font-mono">
                {String(deal.confidence_score)}
              </span>
            </div>
          )}
          {!!deal.recommendation && (
            <div className="flex justify-between">
              <span className="text-gray-400">Recommendation</span>
              <span className="text-gray-800">
                {String(deal.recommendation)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Decision JSON (if present) */}
      {decision && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-2">Decision Detail</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-64 overflow-y-auto">
            {JSON.stringify(decision, null, 2)}
          </pre>
        </div>
      )}

      {/* Omega State */}
      {omegaState && (
        <div className="bg-white border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-500">Omega Belief State</span>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
              AI-Augmented
            </span>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-gray-700 bg-gray-50 p-3 rounded max-h-64 overflow-y-auto">
            {JSON.stringify(omegaState, null, 2)}
          </pre>
        </div>
      )}

      <a
        href={`/examiner-portal/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`}
        className="text-xs text-blue-600 hover:text-blue-800 inline-block"
      >
        ← Back to deal
      </a>
    </div>
  );
}
