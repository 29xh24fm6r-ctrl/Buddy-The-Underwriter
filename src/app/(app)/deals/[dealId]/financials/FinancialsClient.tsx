"use client";

import { useState } from "react";
import Link from "next/link";
import { useSpreadOutput } from "@/hooks/useSpreadOutput";

// ─── Formatting helpers ─────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function fmtX(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(2)}x`;
}

function fmtVariance(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null || prev === 0) return "—";
  const delta = curr - prev;
  const pct = (delta / Math.abs(prev)) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${fmtDollars(delta)} (${sign}${pct.toFixed(1)}%)`;
}

function varianceColor(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null) return "text-white/40";
  return curr >= prev ? "text-emerald-400" : "text-rose-400";
}

function dscrColor(n: number | null): string {
  if (n == null) return "text-white/80";
  if (n >= 1.25) return "text-emerald-400 font-semibold";
  if (n >= 1.0) return "text-amber-400 font-semibold";
  return "text-rose-400 font-semibold";
}

function trendArrow(direction: string | null | undefined): string {
  if (!direction) return "";
  const d = direction.toUpperCase();
  if (d === "IMPROVING" || d === "INCREASING") return " \u2191";
  if (d === "DECLINING" || d === "DECREASING" || d === "COMPRESSING") return " \u2193";
  return " \u2192";
}

function trendColor(direction: string | null | undefined): string {
  if (!direction) return "text-white/40";
  const d = direction.toUpperCase();
  if (d === "IMPROVING" || d === "INCREASING") return "text-emerald-400";
  if (d === "DECLINING" || d === "DECREASING" || d === "COMPRESSING") return "text-rose-400";
  return "text-white/40";
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RatioCell({
  label,
  value,
  trendDir,
}: {
  label: string;
  value: string;
  trendDir?: string | null;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-white/50">{label}</span>
      <span className="text-white font-semibold text-lg leading-tight">
        {value}
        {trendDir && (
          <span className={`text-sm ml-1 ${trendColor(trendDir)}`}>
            {trendArrow(trendDir)}
          </span>
        )}
      </span>
    </div>
  );
}

type RowDef = {
  label: string;
  keys: string[];
  format: "dollars" | "pct" | "x";
  style: "normal" | "bold" | "italic" | "separator" | "header" | "subrow";
};

function buildRows(): RowDef[][] {
  const is_rows: RowDef[] = [
    { label: "INCOME STATEMENT", keys: [], format: "dollars", style: "header" },
    { label: "Gross Revenue / Receipts", keys: ["GROSS_RECEIPTS"], format: "dollars", style: "bold" },
    { label: "Cost of Goods Sold", keys: ["COGS"], format: "dollars", style: "normal" },
    { label: "Gross Profit", keys: ["GROSS_PROFIT"], format: "dollars", style: "bold" },
    { label: "Gross Margin %", keys: ["GROSS_MARGIN"], format: "pct", style: "italic" },
    { label: "Operating Expenses", keys: ["TOTAL_OPERATING_EXPENSES"], format: "dollars", style: "normal" },
    { label: "  Salaries & Wages", keys: ["SALARIES_WAGES_IS", "SALARIES_WAGES"], format: "dollars", style: "subrow" },
    { label: "  Officer Compensation", keys: ["OFFICERS_COMP_IS", "OFFICERS_COMP"], format: "dollars", style: "subrow" },
    { label: "  Rent Expense", keys: ["RENT_EXPENSE_IS", "RENT_EXPENSE"], format: "dollars", style: "subrow" },
    { label: "  Depreciation", keys: ["DEPRECIATION"], format: "dollars", style: "subrow" },
    { label: "  Interest Expense", keys: ["INTEREST_EXPENSE"], format: "dollars", style: "subrow" },
    { label: "  Section 179", keys: ["SK_SECTION_179_DEDUCTION"], format: "dollars", style: "subrow" },
    { label: "Net Income / OBI", keys: ["ORDINARY_BUSINESS_INCOME", "NET_INCOME"], format: "dollars", style: "bold" },
  ];

  const ebitda_rows: RowDef[] = [
    { label: "EBITDA BRIDGE", keys: [], format: "dollars", style: "header" },
    { label: "Net Income / OBI", keys: ["ORDINARY_BUSINESS_INCOME", "NET_INCOME"], format: "dollars", style: "normal" },
    { label: "+ Depreciation", keys: ["DEPRECIATION"], format: "dollars", style: "subrow" },
    { label: "+ Interest Expense", keys: ["INTEREST_EXPENSE"], format: "dollars", style: "subrow" },
    { label: "+ Section 179", keys: ["SK_SECTION_179_DEDUCTION"], format: "dollars", style: "subrow" },
    { label: "= EBITDA", keys: ["EBITDA"], format: "dollars", style: "bold" },
    { label: "EBITDA Margin %", keys: ["EBITDA_MARGIN"], format: "pct", style: "italic" },
  ];

  const cf_rows: RowDef[] = [
    { label: "CASH FLOW & COVERAGE", keys: [], format: "dollars", style: "header" },
    { label: "EBITDA", keys: ["EBITDA"], format: "dollars", style: "normal" },
    { label: "+ Rental Income (Sched E)", keys: ["RENTAL_INCOME_SCHED_E"], format: "dollars", style: "subrow" },
    { label: "Net Cash Avail. for Debt Svc", keys: ["cf_ncads"], format: "dollars", style: "bold" },
    { label: "Annual Debt Service", keys: ["cf_annual_debt_service"], format: "dollars", style: "normal" },
    { label: "DSCR", keys: ["DSCR"], format: "x", style: "bold" },
  ];

  const bs_rows: RowDef[] = [
    { label: "BALANCE SHEET SUMMARY", keys: [], format: "dollars", style: "header" },
    { label: "Total Current Assets", keys: ["BS_CURRENT_ASSETS"], format: "dollars", style: "normal" },
    { label: "Total Assets", keys: ["SL_TOTAL_ASSETS"], format: "dollars", style: "normal" },
    { label: "Total Current Liabilities", keys: ["BS_CURRENT_LIABILITIES"], format: "dollars", style: "normal" },
    { label: "Total Liabilities", keys: ["SL_TOTAL_LIABILITIES"], format: "dollars", style: "normal" },
    { label: "Net Worth / Equity", keys: ["SL_PARTNERS_CAPITAL", "SL_TOTAL_EQUITY"], format: "dollars", style: "bold" },
  ];

  return [is_rows, ebitda_rows, cf_rows, bs_rows];
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function FinancialsClient({ dealId }: { dealId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: spread, loading, error, pricingRequired } = useSpreadOutput(dealId, refreshKey);

  const facts = spread?.canonical_facts ?? {};
  const ratios = spread?.ratios ?? {};
  const years: number[] = (spread?.years_available ?? []).sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;
  const prevYear = years.length > 1 ? years[years.length - 2] : null;

  const trend = spread?.trend_report as
    | Record<string, { direction?: string; values?: (number | null)[] }>
    | undefined;

  // ── Ratio strip values ───────────────────────────────────────────────────
  const latestRevenue = latestYear ? toNum(facts[`GROSS_RECEIPTS_${latestYear}`]) : null;
  const latestEbitda = latestYear ? toNum(facts[`EBITDA_${latestYear}`]) : null;
  const latestEbitdaMargin = latestYear
    ? toNum(ratios[`EBITDA_MARGIN_${latestYear}`] ?? facts[`EBITDA_MARGIN_${latestYear}`])
    : null;
  const latestDscr = latestYear
    ? (toNum(ratios[`DSCR_${latestYear}`]) ?? toNum(ratios["DSCR"]))
    : null;
  const latestGrossMargin = latestYear
    ? toNum(ratios[`GROSS_MARGIN_${latestYear}`] ?? facts[`GROSS_MARGIN_${latestYear}`])
    : null;
  const latestAds = latestYear ? toNum(facts[`cf_annual_debt_service_${latestYear}`]) : null;

  // ── Row rendering ────────────────────────────────────────────────────────
  const allRowGroups = years.length > 0 ? buildRows() : [];
  const showVariance = years.length >= 2;

  function getVal(keyBase: string, year: number): number | null {
    const suffixed = toNum(facts[`${keyBase}_${year}`]);
    if (suffixed !== null) return suffixed;
    const fromRatios = toNum(ratios[`${keyBase}_${year}`] ?? ratios[keyBase]);
    if (fromRatios !== null) return fromRatios;
    return null;
  }

  function getFirstVal(keys: string[], year: number): number | null {
    for (const key of keys) {
      const v = getVal(key, year);
      if (v !== null) return v;
    }
    return null;
  }

  function renderCell(row: RowDef, year: number): string {
    if (row.style === "header") return "";
    const val = getFirstVal(row.keys, year);
    if (val === null) return "\u2014";
    if (row.format === "pct") return fmtPct(val);
    if (row.format === "x") return fmtX(val);
    return fmtDollars(val);
  }

  function renderVariance(row: RowDef): { text: string; color: string } {
    if (
      !showVariance ||
      !latestYear ||
      !prevYear ||
      row.style === "header" ||
      row.keys.length === 0
    ) {
      return { text: "", color: "" };
    }
    const curr = getFirstVal(row.keys, latestYear);
    const prev = getFirstVal(row.keys, prevYear);
    return {
      text:
        row.format === "x" || row.format === "pct"
          ? "\u2014"
          : fmtVariance(curr, prev),
      color: varianceColor(curr, prev),
    };
  }

  // ── DSCR sensitivity ──────────────────────────────────────────────────────
  const ncads = latestYear ? toNum(facts[`cf_ncads_${latestYear}`]) : null;
  const baseAds = latestYear ? toNum(facts[`cf_annual_debt_service_${latestYear}`]) : null;

  const sensitivityRows =
    ncads != null && baseAds != null && baseAds > 0
      ? [
          { label: "\u221220% ADS", multiplier: 0.8 },
          { label: "\u221210% ADS", multiplier: 0.9 },
          { label: "Base", multiplier: 1.0 },
          { label: "+10% ADS", multiplier: 1.1 },
          { label: "+20% ADS", multiplier: 1.2 },
        ].map((r) => ({
          ...r,
          ads: baseAds * r.multiplier,
          dscr: ncads / (baseAds * r.multiplier),
        }))
      : [];

  // ── Ratio narratives ─────────────────────────────────────────────────────
  const narratives = spread?.narrative_report?.ratio_narratives ?? {};
  const NARRATIVE_KEYS = ["DSCR", "DEBT_TO_EBITDA", "TREND_REVENUE", "TREND_MARGIN"];
  const narrativeEntries = NARRATIVE_KEYS.map((k) => ({
    key: k,
    label: k
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    text: narratives[k] ?? null,
  })).filter((e) => e.text);

  // ── Guards ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading financial data\u2026
      </div>
    );
  }

  if (pricingRequired) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-white/60 mb-3">
          Pricing assumptions required to compute debt service and DSCR.
        </p>
        <Link
          href={`/deals/${dealId}/pricing-memo`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          Set Pricing
        </Link>
      </div>
    );
  }

  if (error || years.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/50">
        {error ?? "No financial data available. Upload and extract documents first."}
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-6">
      {/* ── Panel A: Ratio Summary Strip ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <RatioCell
          label="Revenue"
          value={fmtDollars(latestRevenue)}
          trendDir={trend?.trendRevenue?.direction}
        />
        <RatioCell
          label="EBITDA"
          value={fmtDollars(latestEbitda)}
          trendDir={trend?.trendEbitda?.direction}
        />
        <RatioCell
          label="EBITDA Margin"
          value={fmtPct(latestEbitdaMargin)}
          trendDir={trend?.trendGrossMargin?.direction}
        />
        <RatioCell
          label="DSCR"
          value={fmtX(latestDscr)}
          trendDir={trend?.trendDscr?.direction}
        />
        <RatioCell label="Gross Margin" value={fmtPct(latestGrossMargin)} />
        <RatioCell label="Ann. Debt Service" value={fmtDollars(latestAds)} />
      </div>

      {/* ── Panel B: Financial Table ──────────────────────────────────────── */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal w-48">
                Line Item
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal"
                >
                  {y}
                </th>
              ))}
              {showVariance && (
                <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                  &Delta; YoY
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {allRowGroups.map((group, gi) =>
              group.map((row, ri) => {
                if (row.style === "header") {
                  return (
                    <tr
                      key={`h-${gi}-${ri}`}
                      className="border-t border-white/10 bg-white/[0.02]"
                    >
                      <td
                        colSpan={years.length + (showVariance ? 2 : 1)}
                        className="px-4 py-2 text-[10px] uppercase tracking-wide text-white/40 font-semibold"
                      >
                        {row.label}
                      </td>
                    </tr>
                  );
                }
                const variance = renderVariance(row);
                const isSeparator =
                  ri > 0 && group[ri - 1]?.style === "header"
                    ? false
                    : row.style === "bold" && ri > 0;
                return (
                  <tr
                    key={`r-${gi}-${ri}`}
                    className={`border-t border-white/[0.06] hover:bg-white/[0.02] transition-colors ${
                      isSeparator ? "border-t border-white/20" : ""
                    }`}
                  >
                    <td
                      className={`px-4 py-2 ${
                        row.style === "bold"
                          ? "text-white font-semibold"
                          : row.style === "italic"
                            ? "text-white/60 italic text-xs"
                            : row.style === "subrow"
                              ? "text-white/60 pl-7 text-xs"
                              : "text-white/80"
                      }`}
                    >
                      {row.label}
                    </td>
                    {years.map((y) => {
                      const cellVal = renderCell(row, y);
                      const isDscr = row.keys[0] === "DSCR";
                      const rawNum =
                        row.keys.length > 0 ? getFirstVal(row.keys, y) : null;
                      return (
                        <td
                          key={y}
                          className={`text-right px-4 py-2 tabular-nums ${
                            isDscr
                              ? dscrColor(rawNum)
                              : row.style === "bold"
                                ? "text-white font-semibold"
                                : row.style === "italic"
                                  ? "text-white/60 italic text-xs"
                                  : row.style === "subrow"
                                    ? "text-white/60 text-xs"
                                    : "text-white/80"
                          }`}
                        >
                          {cellVal}
                        </td>
                      );
                    })}
                    {showVariance && (
                      <td
                        className={`text-right px-4 py-2 tabular-nums text-xs ${variance.color}`}
                      >
                        {variance.text}
                      </td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>

      {/* ── Panel C: DSCR Sensitivity ─────────────────────────────────────── */}
      {sensitivityRows.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/40 mb-2">
            DSCR Sensitivity &mdash; ADS Scenarios
          </div>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Scenario
                  </th>
                  <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    Ann. Debt Service
                  </th>
                  <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wide text-white/40 font-normal">
                    DSCR
                  </th>
                </tr>
              </thead>
              <tbody>
                {sensitivityRows.map((r) => (
                  <tr
                    key={r.label}
                    className={`border-t border-white/[0.06] ${
                      r.multiplier === 1.0 ? "bg-white/[0.04]" : ""
                    }`}
                  >
                    <td
                      className={`px-4 py-2 ${
                        r.multiplier === 1.0
                          ? "text-white font-semibold"
                          : "text-white/70"
                      }`}
                    >
                      {r.label}
                    </td>
                    <td
                      className={`text-right px-4 py-2 tabular-nums ${
                        r.multiplier === 1.0
                          ? "text-white font-semibold"
                          : "text-white/70"
                      }`}
                    >
                      {fmtDollars(r.ads)}
                    </td>
                    <td
                      className={`text-right px-4 py-2 tabular-nums ${dscrColor(r.dscr)}`}
                    >
                      {fmtX(r.dscr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Panel D: Ratio Narratives ─────────────────────────────────────── */}
      {narrativeEntries.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wide text-white/40">
            Analysis
          </div>
          {narrativeEntries.map((e) => (
            <div
              key={e.key}
              className="border-l-2 border-white/20 bg-white/[0.02] rounded-r-lg px-4 py-3"
            >
              <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">
                {e.label}
              </div>
              <p className="text-sm text-white/70 leading-relaxed">{e.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Panel E: Actions bar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2 border-t border-white/5">
        <a
          href={`/api/deals/${dealId}/classic-spread`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
        >
          &darr; Classic Spread PDF
        </a>
        <button
          type="button"
          disabled
          title="Committee Studio — Phase 15"
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs text-white/30 cursor-not-allowed"
        >
          &uarr; Export to Committee
        </button>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 ml-auto"
        >
          &#x27F3; Refresh
        </button>
      </div>
    </div>
  );
}
