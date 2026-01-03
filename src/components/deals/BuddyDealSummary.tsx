"use client";

import { useEffect, useState } from "react";
import { usePipelineState } from "@/lib/pipeline/usePipelineState";

type BuddySummary = {
  short: string;
  long: string;
  updated_at: string;
};

type Props = {
  dealId: string;
  variant?: "compact" | "full";
};

/**
 * 🤖 Buddy Explains This Deal
 * 
 * Shows AI-generated explanation of deal state, grounded in pipeline ledger.
 * Auto-refreshes when pipeline state changes.
 * 
 * Usage:
 * <BuddyDealSummary dealId={dealId} variant="full" />
 */
export function BuddyDealSummary({ dealId, variant = "full" }: Props) {
  const { pipeline } = usePipelineState(dealId);
  const [summary, setSummary] = useState<BuddySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-refresh when pipeline state changes
    if (!dealId) return;

    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/deals/${dealId}/summary`, {
          method: "POST",
          cache: "no-store",
        });

        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.error || "Failed to fetch summary");
        }

        setSummary(data.summary);
      } catch (e: any) {
        console.error("[BuddyDealSummary] Error:", e);
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };

    void fetchSummary();
  }, [dealId, pipeline.lastUpdatedAt]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="text-sm text-red-700">Failed to load summary</div>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gradient-to-r from-gray-50 to-white p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">🤖</div>
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  if (variant === "compact") {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-sm text-blue-900">{summary.short}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="text-3xl">🤖</div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-blue-900">Buddy Explains</h3>
            {pipeline.isWorking && (
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            )}
          </div>
          <p className="text-base font-medium text-gray-900">{summary.short}</p>
          <p className="text-sm leading-relaxed text-gray-700">{summary.long}</p>
          <div className="pt-1 text-xs text-gray-500">
            Last updated: {new Date(summary.updated_at).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}
