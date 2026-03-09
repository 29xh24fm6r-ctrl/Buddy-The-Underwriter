"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SpreadOutputReport } from "@/lib/spreadOutput/types";
import { ExecutiveSummaryPanel } from "@/components/deals/cockpit/panels/spread/ExecutiveSummaryPanel";
import { NormalizedSpreadPanel } from "@/components/deals/cockpit/panels/spread/NormalizedSpreadPanel";
import { RatioScorecardPanel } from "@/components/deals/cockpit/panels/spread/RatioScorecardPanel";
import { StoryPanelView } from "@/components/deals/cockpit/panels/spread/StoryPanelView";

type TabKey = "summary" | "spread" | "ratios" | "story";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "summary", label: "Executive Summary", icon: "dashboard" },
  { key: "spread", label: "Financial Spread", icon: "table_chart" },
  { key: "ratios", label: "Ratio Scorecard", icon: "monitoring" },
  { key: "story", label: "Credit Story", icon: "auto_stories" },
];

type Props = {
  dealId: string;
  dealName: string;
  dealType: string | null;
};

export function SpreadsPageClient({ dealId, dealName, dealType }: Props) {
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
      setError(err instanceof Error ? err.message : "Failed to load spread output");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  const handleExport = useCallback(async () => {
    try {
      setIsExporting(true);
      const res = await fetch(`/api/deals/${dealId}/credit-memo/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* ── Top Nav Bar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/deals/${dealId}/cockpit`}
              className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Deal Cockpit</span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900">{dealName}</span>
            {dealType && (
              <span className="ml-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                {dealType}
              </span>
            )}
          </div>

          {/* Page title */}
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-blue-600">table_chart</span>
            <h1 className="text-base font-bold text-gray-900">Financial Spreads</h1>
          </div>

          {/* Export actions */}
          {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
          <a ref={downloadRef} className="hidden" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <button
              onClick={handleClassicExport}
              disabled={isClassicExporting || !report}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isClassicExporting ? (
                <svg className="h-4 w-4 animate-spin text-gray-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <span className="material-symbols-outlined text-[16px]">download</span>
              )}
              Classic Spread PDF
            </button>

            <button
              onClick={handleExport}
              disabled={isExporting || !report}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
              )}
              Export Credit Memo
            </button>
          </div>
        </div>
      </header>

      {/* ── Spread Tab Nav ───────────────────────────────────────────── */}
      <div className="sticky top-[57px] z-10 border-b border-gray-200 bg-white px-6">
        <div className="mx-auto max-w-[1400px] flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center pb-2">
            <button
              onClick={fetchReport}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Refresh spread data"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-[1400px]">
          {loading && (
            <div className="flex h-64 items-center justify-center">
              <div className="text-sm text-gray-400 animate-pulse">Loading financial data...</div>
            </div>
          )}

          {pricingRequired && !loading && (
            <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50">
              <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900">
                Pricing assumptions required
              </h3>
              <p className="text-sm text-gray-500 max-w-sm text-center">
                Spreads cannot be generated until pricing assumptions have been saved.
                Set the proposed loan amount, rate, and term on the Pricing tab first.
              </p>
              <Link
                href={`/deals/${dealId}/cockpit`}
                className="mt-2 inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
              >
                Set Pricing Assumptions →
              </Link>
            </div>
          )}

          {error && !loading && !pricingRequired && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6">
              <p className="text-sm font-medium text-red-700">{error}</p>
              <button
                onClick={fetchReport}
                className="mt-3 text-sm text-red-600 underline hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && !report && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200">
              <span className="material-symbols-outlined text-[40px] text-gray-300">table_chart</span>
              <p className="text-sm text-gray-500">
                No spread data available — financial documents must be processed first.
              </p>
              <Link
                href={`/deals/${dealId}/cockpit`}
                className="mt-1 text-sm text-blue-600 underline hover:text-blue-800"
              >
                Return to cockpit to check document status
              </Link>
            </div>
          )}

          {/* ── Light-themed sub-panels ──────────────────────────────── */}
          {report && !loading && (
            <div className="space-y-0">
              {tab === "summary" && (
                <SpreadsSection title="Executive Summary" icon="dashboard">
                  <ExecutiveSummaryPanel summary={report.executive_summary} theme="light" />
                </SpreadsSection>
              )}
              {tab === "spread" && (
                <SpreadsSection title="Financial Spread" icon="table_chart">
                  <NormalizedSpreadPanel spread={report.normalized_spread} theme="light" />
                </SpreadsSection>
              )}
              {tab === "ratios" && (
                <SpreadsSection title="Ratio Scorecard" icon="monitoring">
                  <RatioScorecardPanel scorecard={report.ratio_scorecard} theme="light" />
                </SpreadsSection>
              )}
              {tab === "story" && (
                <SpreadsSection title="Credit Story" icon="auto_stories">
                  <StoryPanelView panel={report.story_panel} theme="light" />
                </SpreadsSection>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Section Wrapper ──────────────────────────────────────────────────────────
function SpreadsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
        <span className="material-symbols-outlined text-[18px] text-blue-600">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
