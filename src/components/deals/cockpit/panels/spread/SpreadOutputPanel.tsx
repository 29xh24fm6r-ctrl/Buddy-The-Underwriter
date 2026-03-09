"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpreadOutputReport } from "@/lib/spreadOutput/types";
import { ExecutiveSummaryPanel } from "./ExecutiveSummaryPanel";
import { NormalizedSpreadPanel } from "./NormalizedSpreadPanel";
import { RatioScorecardPanel } from "./RatioScorecardPanel";
import { StoryPanelView } from "./StoryPanelView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = "summary" | "spread" | "ratios" | "story";

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "spread", label: "Spread" },
  { key: "ratios", label: "Ratios" },
  { key: "story", label: "Story" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpreadOutputPanel({ dealId }: { dealId: string }) {
  const [tab, setTab] = useState<TabKey>("summary");
  const [report, setReport] = useState<SpreadOutputReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pricingRequired, setPricingRequired] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClassicExporting, setIsClassicExporting] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setPricingRequired(false);
      const res = await fetch(`/api/deals/${dealId}/spread-output`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "pricing_assumptions_required") {
          setPricingRequired(true);
          return;
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load spread output";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  const handleExport = useCallback(async () => {
    try {
      setIsExporting(true);
      const res = await fetch(`/api/deals/${dealId}/credit-memo/export`);
      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = `CreditMemo_${dealId.slice(0, 8)}.pdf`;
        downloadRef.current.click();
      }
      URL.revokeObjectURL(url);
    } catch {
      alert("PDF generation failed — try again");
    } finally {
      setIsExporting(false);
    }
  }, [dealId]);

  const handleClassicExport = useCallback(async () => {
    try {
      setIsClassicExporting(true);
      const res = await fetch(`/api/deals/${dealId}/classic-spread`);
      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = `ClassicSpread_${dealId.slice(0, 8)}.pdf`;
        downloadRef.current.click();
      }
      URL.revokeObjectURL(url);
    } catch {
      alert("Classic Spread PDF generation failed — try again");
    } finally {
      setIsClassicExporting(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Pricing gate
  if (pricingRequired) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="text-amber-500">
          <svg className="w-10 h-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-zinc-100">
          Pricing assumptions required
        </h3>
        <p className="text-sm text-zinc-400 max-w-sm">
          Spreads cannot be generated until pricing assumptions have been saved.
          Set the proposed loan amount, rate, and term on the Pricing tab first.
        </p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-6 text-center">
        <div className="animate-pulse text-sm text-zinc-400">Loading spread output...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchReport}
          className="mt-2 text-xs text-red-300 underline hover:text-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  // No data
  if (!report) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-center">
        <p className="text-sm text-zinc-400">
          No spread output available — financial data must be extracted and spread first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden download anchor */}
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
      <a ref={downloadRef} className="hidden" aria-hidden="true" />

      {/* Tab bar + Export button */}
      <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-1">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleClassicExport}
            disabled={isClassicExporting}
            className="flex items-center gap-1.5 rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isClassicExporting ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </>
            ) : (
              "Classic Spread"
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating PDF...
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Export Credit Memo
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === "summary" && <ExecutiveSummaryPanel summary={report.executive_summary} />}
      {tab === "spread" && <NormalizedSpreadPanel spread={report.normalized_spread} />}
      {tab === "ratios" && <RatioScorecardPanel scorecard={report.ratio_scorecard} />}
      {tab === "story" && <StoryPanelView panel={report.story_panel} />}
    </div>
  );
}
