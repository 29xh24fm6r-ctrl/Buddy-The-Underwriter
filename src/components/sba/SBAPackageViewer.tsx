"use client";

import { useState } from "react";
import type {
  SBAPackageData,
  BalanceSheetYear,
  GlobalCashFlowResult,
} from "@/lib/sba/sbaReadinessTypes";
import DSCRAlertBanner from "./DSCRAlertBanner";
import SBAVersionHistory from "./SBAVersionHistory";
import SBACCOReviewDashboard from "./SBACCOReviewDashboard";

// Phase BPG — the viewer may be given a package row that includes new columns
// (global_dscr, global_cash_flow, balance_sheet_projections). SBAPackageData
// does not yet carry them, so we allow a broader shape on top of the base.
// Phase 3 — also expose package id + full narrative columns so the
// borrower refinement loop can target individual sections.
type ExtendedPkg = SBAPackageData & {
  id?: string;
  globalDscr?: number | null;
  globalCashFlow?: GlobalCashFlowResult | null;
  balanceSheetProjections?: BalanceSheetYear[] | null;
  executiveSummary?: string | null;
  industryAnalysis?: string | null;
  marketingStrategy?: string | null;
  operationsPlan?: string | null;
  swotStrengths?: string | null;
  swotWeaknesses?: string | null;
  swotOpportunities?: string | null;
  swotThreats?: string | null;
  franchiseSection?: string | null;
};

interface Props {
  dealId: string;
  pkg: ExtendedPkg;
  generating: boolean;
  onRegenerate: () => void;
  onSubmit: () => void;
}

const SECTIONS = [
  { id: "summary", label: "Executive Summary" },
  { id: "company", label: "Company" },
  { id: "industry", label: "Industry" },
  { id: "swot", label: "SWOT" },
  { id: "financials", label: "Financials" },
  { id: "sensitivity", label: "Sensitivity" },
  { id: "sources", label: "Sources & Uses" },
];

function dscrColor(val: number): string {
  if (val >= 1.25) return "text-emerald-400";
  if (val >= 1.0) return "text-amber-400";
  return "text-red-400";
}

function fmtCurrency(val: number): string {
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// Phase 3 — section_key → (label, columnOnPkg) for the borrower
// refinement loop. These keys must match the SECTION_COLUMNS on the
// refine-section API route.
const REFINABLE_SECTIONS: Array<{
  key: string;
  label: string;
  pkgField: keyof ExtendedPkg;
}> = [
  { key: "executive_summary", label: "Executive Summary", pkgField: "executiveSummary" },
  { key: "industry_analysis", label: "Industry Analysis", pkgField: "industryAnalysis" },
  { key: "marketing_strategy", label: "Marketing Strategy", pkgField: "marketingStrategy" },
  { key: "operations_plan", label: "Operations Plan", pkgField: "operationsPlan" },
  { key: "business_overview_narrative", label: "Business Overview", pkgField: "businessOverviewNarrative" },
  { key: "sensitivity_narrative", label: "Sensitivity Narrative", pkgField: "sensitivityNarrative" },
  { key: "franchise_section", label: "Franchise Section", pkgField: "franchiseSection" },
  { key: "swot_strengths", label: "SWOT — Strengths", pkgField: "swotStrengths" },
  { key: "swot_weaknesses", label: "SWOT — Weaknesses", pkgField: "swotWeaknesses" },
  { key: "swot_opportunities", label: "SWOT — Opportunities", pkgField: "swotOpportunities" },
  { key: "swot_threats", label: "SWOT — Threats", pkgField: "swotThreats" },
];

export default function SBAPackageViewer({
  dealId,
  pkg,
  generating,
  onRegenerate,
  onSubmit,
}: Props) {
  const failingYears = [1, 2, 3].filter((y) => {
    const dscr = y === 1 ? pkg.dscrYear1Base : y === 2 ? pkg.dscrYear2Base : pkg.dscrYear3Base;
    return dscr < 1.25;
  });

  const lowestDscr = Math.min(pkg.dscrYear1Base, pkg.dscrYear2Base, pkg.dscrYear3Base);

  const breakEven = pkg.breakEven;

  const [activeSection, setActiveSection] = useState<string>("summary");
  const [reviewOpen, setReviewOpen] = useState(false);
  const globalDscr = pkg.globalDscr ?? pkg.globalCashFlow?.globalDSCR ?? null;
  const balanceSheet = pkg.balanceSheetProjections ?? [];

  // Phase 3 — borrower refinement loop. Live-update narrative text so the
  // next rewrite targets the most recent content without a round-trip.
  const [narratives, setNarratives] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of REFINABLE_SECTIONS) {
      const v = pkg[s.pkgField];
      if (typeof v === "string") init[s.key] = v;
    }
    return init;
  });
  const [refiningSection, setRefiningSection] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  async function handleRefineSection(sectionKey: string) {
    if (!feedbackText.trim()) return;
    if (!pkg.id) {
      setRefineError("This package is missing an id — can't target refinement.");
      return;
    }
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/sba`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refine-section",
          section: sectionKey,
          feedback: feedbackText,
          packageId: pkg.id,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setRefineError(json.error ?? "Rewrite failed");
        return;
      }
      setNarratives((prev) => ({ ...prev, [sectionKey]: json.updatedText }));
      setRefiningSection(null);
      setFeedbackText("");
    } catch {
      setRefineError("Network error while rewriting section");
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Phase BPG — Section navigation tabs */}
      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-1">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveSection(sec.id)}
            className={`text-xs rounded-t-md px-3 py-1.5 border-b-2 transition ${
              activeSection === sec.id
                ? "border-blue-400 text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* DSCR Alert Banner */}
      <DSCRAlertBanner
        dealId={dealId}
        dscrBelowThreshold={pkg.dscrBelowThreshold}
        failingYears={failingYears}
        lowestDscr={lowestDscr}
      />

      {/* Phase BPG — Global DSCR card */}
      {globalDscr !== null && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white/80">
            Global DSCR (Business + Guarantors)
          </h3>
          <div className="flex items-baseline gap-3">
            <span
              className={`text-2xl font-mono ${
                globalDscr >= 1.25
                  ? "text-emerald-400"
                  : globalDscr >= 1.0
                    ? "text-amber-400"
                    : "text-red-400"
              }`}
            >
              {globalDscr.toFixed(2)}x
            </span>
            <span className="text-xs text-white/50">SBA minimum: 1.25x</span>
          </div>
          {pkg.globalCashFlow?.guarantorsWithNegativeCashFlow ? (
            <div className="text-xs text-amber-300">
              {pkg.globalCashFlow.guarantorsWithNegativeCashFlow} guarantor(s)
              with negative personal cash flow.
            </div>
          ) : null}
        </div>
      )}

      {/* Phase BPG — Balance sheet summary card */}
      {balanceSheet.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white/80">
            Projected Balance Sheet
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/50">
                  <th className="text-left py-1 pr-3"></th>
                  {balanceSheet.map((bs) => (
                    <th key={bs.year} className="text-right py-1 px-2">
                      {bs.label === "Actual" ? "Base" : `Y${bs.year}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Total Assets", (b: BalanceSheetYear) => b.totalAssets],
                    [
                      "Total Liabilities",
                      (b: BalanceSheetYear) => b.totalLiabilities,
                    ],
                    ["Total Equity", (b: BalanceSheetYear) => b.totalEquity],
                    ["Current Ratio", (b: BalanceSheetYear) => b.currentRatio],
                    ["Debt to Equity", (b: BalanceSheetYear) => b.debtToEquity],
                  ] as const
                ).map(([label, getter]) => (
                  <tr key={label} className="border-t border-white/5">
                    <td className="py-1 pr-3 text-white/70">{label}</td>
                    {balanceSheet.map((bs) => (
                      <td
                        key={bs.year}
                        className="text-right py-1 px-2 font-mono text-white/70"
                      >
                        {label.includes("Ratio") || label.includes("Equity")
                          ? label.includes("Ratio") || label === "Debt to Equity"
                            ? getter(bs).toFixed(2)
                            : `$${Math.round(getter(bs)).toLocaleString()}`
                          : `$${Math.round(getter(bs)).toLocaleString()}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DSCR Summary Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">DSCR Summary</h3>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div />
          <div className="text-center text-white/50">Year 1</div>
          <div className="text-center text-white/50">Year 2</div>
          <div className="text-center text-white/50">Year 3</div>

          <div className="text-white/60">Base Case</div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear1Base)}`}>
            {pkg.dscrYear1Base.toFixed(2)}x
          </div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear2Base)}`}>
            {pkg.dscrYear2Base.toFixed(2)}x
          </div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear3Base)}`}>
            {pkg.dscrYear3Base.toFixed(2)}x
          </div>

          <div className="text-white/60">Downside Y1</div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear1Downside)}`}>
            {pkg.dscrYear1Downside.toFixed(2)}x
          </div>
          <div />
          <div />
        </div>
        <div className="text-xs text-white/40">SBA minimum: 1.25x</div>
      </div>

      {/* Break-Even Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Break-Even Analysis</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-white/50">Break-Even Revenue</span>
            <div className="text-white font-mono">
              {fmtCurrency(breakEven.breakEvenRevenue)}
            </div>
          </div>
          <div>
            <span className="text-white/50">Projected Y1 Revenue</span>
            <div className="text-white font-mono">
              {fmtCurrency(breakEven.projectedRevenueYear1)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-white/50">Margin of Safety:</span>
          <span
            className={`font-mono font-semibold ${
              breakEven.flagLowMargin ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {(breakEven.marginOfSafetyPct * 100).toFixed(1)}%
          </span>
          {breakEven.flagLowMargin && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                warning
              </span>
              Below 10% margin of safety
            </span>
          )}
        </div>
      </div>

      {/* Sensitivity Table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Sensitivity Analysis</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/50 text-xs">
                <th className="text-left py-1 pr-3">Scenario</th>
                <th className="text-right py-1 px-2">Y1 Revenue</th>
                <th className="text-right py-1 px-2">EBITDA Margin</th>
                <th className="text-right py-1 px-2">DSCR Y1</th>
                <th className="text-right py-1 px-2">DSCR Y2</th>
                <th className="text-right py-1 px-2">DSCR Y3</th>
                <th className="text-right py-1 pl-2">SBA Threshold</th>
              </tr>
            </thead>
            <tbody>
              {pkg.sensitivityScenarios.map((s) => (
                <tr key={s.name} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-white/80">{s.label}</td>
                  <td className="text-right py-1.5 px-2 font-mono text-white/70">
                    {fmtCurrency(s.revenueYear1)}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-white/70">
                    {(s.ebitdaMarginYear1 * 100).toFixed(1)}%
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear1)}`}>
                    {s.dscrYear1.toFixed(2)}x
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear2)}`}>
                    {s.dscrYear2.toFixed(2)}x
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear3)}`}>
                    {s.dscrYear3.toFixed(2)}x
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {s.passesSBAThreshold ? (
                      <span className="text-emerald-400 text-xs">Pass</span>
                    ) : (
                      <span className="text-red-400 text-xs">Below 1.25x</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phase 3 — Narrative sections with borrower refinement loop */}
      {REFINABLE_SECTIONS.some((s) => narratives[s.key]) && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white/80">
            Narrative Sections
          </h3>
          {refineError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              {refineError}
            </div>
          )}
          {REFINABLE_SECTIONS.filter((s) => narratives[s.key]).map((s) => (
            <div
              key={s.key}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white/80">
                  {s.label}
                </h4>
                {refiningSection !== s.key && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefiningSection(s.key);
                      setFeedbackText("");
                      setRefineError(null);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    This isn&apos;t quite right →
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-white/60 whitespace-pre-line line-clamp-[8]">
                {narratives[s.key]}
              </p>

              {refiningSection === s.key && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <label className="text-sm font-medium text-amber-300">
                    Tell Buddy what to change:
                  </label>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="We actually focus on corporate catering, not dine-in service…"
                    className="w-full rounded-lg bg-white/5 border border-white/10 p-3 text-sm text-white placeholder:text-white/30 min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRefineSection(s.key)}
                      disabled={!feedbackText.trim() || refining}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                    >
                      {refining ? "Rewriting…" : "Rewrite This Section"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRefiningSection(null);
                        setFeedbackText("");
                      }}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => {
            if (pkg.pdfUrl) {
              window.open(`/api/storage/${pkg.pdfUrl}`, "_blank");
            }
          }}
          disabled={!pkg.pdfUrl}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download PDF
        </button>

        <button
          onClick={onRegenerate}
          disabled={generating}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          {generating ? "Generating..." : "Re-generate"}
        </button>

        <button
          onClick={onSubmit}
          disabled={pkg.status === "submitted"}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pkg.status === "submitted" ? "Submitted" : "Mark as Submitted"}
        </button>

        {/* Phase 2 — CCO review entry point */}
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-500/15"
        >
          Open CCO Review
        </button>
      </div>

      {/* Phase BPG — Version history timeline */}
      <SBAVersionHistory dealId={dealId} />

      {/* Phase 2 — CCO review dashboard (modal overlay) */}
      {reviewOpen && (
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/70 p-4 overflow-y-auto"
          onClick={() => setReviewOpen(false)}
        >
          <div
            className="relative mx-auto w-full max-w-5xl rounded-2xl border border-white/10 bg-[#0a0f1a] p-6 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                CCO Review Dashboard
              </h3>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                className="text-sm text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            <SBACCOReviewDashboard dealId={dealId} />
          </div>
        </div>
      )}
    </div>
  );
}
