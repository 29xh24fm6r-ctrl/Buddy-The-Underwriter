// src/components/deals/DscrTrendCard.tsx

"use client";

import React, { useMemo, useState } from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { computeDscrTrend } from "@/lib/finance/underwriting/dscrTrend";

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDscr(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)}x`;
}

function badgeClass(dscr: number | null): string {
  if (dscr === null) return "bg-muted";
  if (dscr >= 1.25) return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (dscr >= 1.0) return "bg-amber-50 border-amber-200 text-amber-800";
  return "bg-red-50 border-red-200 text-red-800";
}

export default function DscrTrendCard({
  spreadsByYear,
  adsStr,
  setAdsStr,
  annualDebtService,
  selectedYear,
  adsByYear,
  setAdsByYear,
  getAnnualDebtServiceForYear,
}: {
  spreadsByYear: Record<number, TaxSpread>;
  adsStr: string;
  setAdsStr: (v: string) => void;
  annualDebtService: number | null;
  selectedYear: number | null;
  adsByYear: Record<number, string>;
  setAdsByYear: (v: Record<number, string>) => void;
  getAnnualDebtServiceForYear: (year: number) => number | null;
}) {
  const [useSameAdsForAllYears, setUseSameAdsForAllYears] = useState(true);

  const trend = useMemo(() => {
    // If toggle is on, apply ADS to all years. If off, use per-year ADS
    const ads = useSameAdsForAllYears ? annualDebtService : null; // null means use per-year
    return computeDscrTrend(spreadsByYear, ads, useSameAdsForAllYears ? undefined : getAnnualDebtServiceForYear);
  }, [spreadsByYear, annualDebtService, useSameAdsForAllYears, getAnnualDebtServiceForYear]);

  const years = Object.keys(spreadsByYear)
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);

  if (years.length < 2) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">DSCR Trend</div>
        <div className="text-xs text-muted-foreground">
          Worst year: {trend.worst?.year ?? "—"} ({fmtDscr(trend.worst?.dscr ?? null)})
        </div>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Annual Debt Service</div>
          <input
            value={adsStr}
            onChange={(e) => setAdsStr(e.target.value)}
            placeholder="e.g., 185000"
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />

          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useSameAdsForAllYears}
              onChange={(e) => setUseSameAdsForAllYears(e.target.checked)}
            />
            Use this ADS for all years
          </label>
        </div>

        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Worst DSCR</div>
          <div className="text-sm font-semibold">{fmtDscr(trend.worst?.dscr ?? null)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Worst year CFADS: {fmtMoney(trend.worst?.cfads ?? null)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] space-y-2">
          {trend.series.map((s) => {
            const year = s.year ?? null;
            const isSelected = year !== null && selectedYear !== null && year === selectedYear;

            return (
              <div
                key={String(s.year)}
                className={[
                  "flex items-center justify-between rounded border p-3",
                  isSelected ? "ring-2 ring-black" : "",
                ].join(" ")}
              >
                <div className="text-sm font-medium">TY {s.year ?? "—"}</div>

                <div className="text-xs text-muted-foreground">
                  CFADS: {fmtMoney(s.cfads)} • ADS: {fmtMoney(s.annual_debt_service)}
                </div>

                <div className={["rounded-full border px-2 py-1 text-xs", badgeClass(s.dscr)].join(" ")}>
                  {fmtDscr(s.dscr)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!!trend.flags.length && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <div className="font-medium">Flags</div>
          <ul className="list-disc pl-4">
            {trend.flags.slice(0, 12).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}