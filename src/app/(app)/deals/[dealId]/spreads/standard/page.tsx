"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SpreadViewModelTable } from "@/components/deals/spreads/SpreadViewModelTable";
import type { SpreadViewModel } from "@/lib/modelEngine/renderer/types";

export default function StandardSpreadPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [viewModel, setViewModel] = React.useState<SpreadViewModel | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads/standard`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load financial analysis");
      setViewModel(json.viewModel ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load financial analysis");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
        </div>
        <div className="py-12 text-center text-xs text-white/50">Loading financial analysis...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Retry
          </button>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!viewModel || !viewModel.sections?.length) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Icon name="fact_check" className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white/50">No financial analysis data available yet.</p>
          <p className="mt-1 text-xs text-white/30">
            Upload financial documents and ensure spreads are computed to populate the financial analysis.
          </p>
        </div>
      </div>
    );
  }

  const meta = { row_count: viewModel.meta.rowCount, period_count: viewModel.meta.periodCount };
  const generatedAt = viewModel.generatedAt;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {meta.row_count ?? 0} line items &middot; {meta.period_count ?? 1} period{(meta.period_count ?? 1) > 1 ? "s" : ""} &middot; Generated {generatedAt ? new Date(generatedAt).toLocaleDateString() : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
          <a
            href={`/api/deals/${dealId}/spreads/standard/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
          >
            <Icon name="file" className="h-4 w-4" />
            Export PDF
          </a>
        </div>
      </div>

      <SpreadViewModelTable viewModel={viewModel} />
    </div>
  );
}
