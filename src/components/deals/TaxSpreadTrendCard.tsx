// src/components/deals/TaxSpreadTrendCard.tsx
"use client";

import React from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { buildYoySeries } from "@/lib/finance/tax/taxSpreadYoy";

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDelta(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(p: number | null): string {
  if (p === null) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${Math.round(p * 100)}%`;
}

function badgeClass(delta: number | null): string {
  if (delta === null) return "bg-muted";
  if (delta > 0) return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (delta < 0) return "bg-red-50 border-red-200 text-red-800";
  return "bg-muted";
}

export default function TaxSpreadTrendCard({
  spreadsByYear,
  selectedYear,
}: {
  spreadsByYear: Record<number, TaxSpread>;
  selectedYear: number | null;
}) {
  const rev = buildYoySeries(spreadsByYear, "revenue");
  const ebitda = buildYoySeries(spreadsByYear, "ebitda");
  const ni = buildYoySeries(spreadsByYear, "net_income");
  const cfads = buildYoySeries(spreadsByYear, "cfads_proxy");

  const years = Object.keys(spreadsByYear)
    .map((y) => Number(y))
    .sort((a, b) => b - a);

  if (!years.length) return null;

  const activeYear = selectedYear ?? years[0];

  const hasAnyCfads = Object.values(spreadsByYear).some((s) => s.cfads_proxy !== null);

  const row = (
    label: string,
    series: { year: number; value: number | null; delta: number | null; deltaPct: number | null }[]
  ) => {
    const cur = series.find((s) => s.year === activeYear) ?? null;
    return (
      <div className="flex items-center justify-between gap-3 rounded border p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-semibold">{fmtMoney(cur?.value ?? null)}</div>
        </div>
        <div
          className={[
            "shrink-0 rounded-full border px-2 py-1 text-xs",
            badgeClass(cur?.delta ?? null),
          ].join(" ")}
          title="Year-over-year change vs prior year"
        >
          {fmtDelta(cur?.delta ?? null)} ({fmtPct(cur?.deltaPct ?? null)})
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Multi-Year Trend</div>
        <div className="text-xs text-muted-foreground">
          Showing YoY vs prior year (TY {activeYear})
        </div>
      </div>

      <div className="space-y-2">
        {row("Revenue", rev)}
        {row("EBITDA", ebitda)}
        {row("Net Income", ni)}
        {hasAnyCfads ? row("CFADS (Proxy)", cfads) : null}
      </div>
    </div>
  );
}