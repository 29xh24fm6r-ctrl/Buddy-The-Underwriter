"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SpreadViewModelTable } from "@/components/deals/spreads/SpreadViewModelTable";
import type { SpreadViewModel } from "@/lib/modelEngine/renderer/types";

// ── Pipeline error context (shows actionable diagnostics on error) ──

function PipelineErrorContext({ dealId }: { dealId: string }) {
  const [hint, setHint] = React.useState<string | null>(null);
  const [ledger, setLedger] = React.useState<
    Array<{ event_key: string | null; stage: string; status: string; created_at: string }>
  >([]);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/pipeline-status`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.ok) return;

        // Derive actionable hint
        if (json.docs.total === 0) {
          setHint("Upload financial documents to begin.");
        } else if (json.docs.classified === 0) {
          setHint("Documents are being processed (OCR/Classification).");
        } else if (json.facts.total === 0) {
          setHint("Financial data is being extracted from documents.");
        } else if (json.spreads.ready === 0 && json.spreads.error === 0) {
          setHint("Spreads are being generated.");
        } else if (json.spreads.error > 0) {
          setHint(`${json.spreads.error} spread(s) failed. Check the deal cockpit for details.`);
        }

        // Last 3 ledger events
        setLedger((json.ledger ?? []).slice(0, 3));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [dealId]);

  return (
    <div className="space-y-2 pt-1">
      {hint && (
        <div className="text-white/60 text-xs">
          {hint}
        </div>
      )}
      {ledger.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-white/40 font-semibold">Recent pipeline events:</div>
          {ledger.map((e, i) => (
            <div key={`${e.created_at}-${i}`} className="flex items-center gap-1.5 text-[10px] text-white/40">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  e.status === "ok" ? "bg-emerald-400" : e.status === "error" ? "bg-red-400" : "bg-amber-400"
                }`}
              />
              <span>{e.event_key ?? e.stage}</span>
              <span className="text-white/20 ml-auto">{e.created_at?.slice(0, 16).replace("T", " ")}</span>
            </div>
          ))}
        </div>
      )}
      <Link
        href={`/deals/${dealId}/cockpit`}
        className="inline-flex items-center gap-1 text-[10px] text-sky-300 hover:text-sky-200"
      >
        View deal cockpit
      </Link>
    </div>
  );
}

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
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300 space-y-2">
          <div>{error}</div>
          <PipelineErrorContext dealId={dealId} />
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
