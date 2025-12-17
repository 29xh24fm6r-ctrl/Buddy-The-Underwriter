// src/components/deals/UnderwriterSummaryCard.tsx
"use client";

import React, { useMemo } from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { analyzeUnderwriting } from "@/lib/finance/underwriting/analyzeDeal";
import { DEFAULT_POLICY } from "@/lib/finance/underwriting/policy";

function badgeClass(level: "green" | "amber" | "red") {
  if (level === "green") return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (level === "amber") return "bg-amber-50 border-amber-200 text-amber-800";
  return "bg-red-50 border-red-200 text-red-800";
}

export default function UnderwriterSummaryCard({
  spreadsByYear,
  adsStr,
  setAdsStr,
  annualDebtService,
  clearAds,
}: {
  spreadsByYear: Record<number, TaxSpread>;
  adsStr: string;
  setAdsStr: (v: string) => void;
  annualDebtService: number | null;
  clearAds?: () => void;
}) {
  const summary = useMemo(
    () => analyzeUnderwriting(spreadsByYear, annualDebtService, DEFAULT_POLICY),
    [spreadsByYear, annualDebtService]
  );

  const hasYears = Object.keys(spreadsByYear).length > 0;
  if (!hasYears) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Underwriter Summary</div>
        <div className={["rounded-full border px-2 py-1 text-xs", badgeClass(summary.overall)].join(" ")}>
          {summary.overall.toUpperCase()}
        </div>
      </div>

      <div className="mb-3 text-sm font-medium">{summary.headline}</div>

      <div className="mb-3 rounded border p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">Annual Debt Service (for summary)</div>
          <button
            type="button"
            className="text-xs underline"
            onClick={clearAds || (() => setAdsStr(""))}
          >
            Clear
          </button>
        </div>
        <input
          value={adsStr}
          onChange={(e) => setAdsStr(e.target.value)}
          placeholder="e.g., 185000"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
        />
      </div>

      {!!summary.bullets.length && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {summary.bullets.slice(0, 10).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}