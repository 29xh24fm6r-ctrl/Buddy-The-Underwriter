// src/components/deals/DscrWowCard.tsx
"use client";

import React, { useMemo } from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { computeDscr } from "@/lib/finance/underwriting/dscr";

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDscr(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)}x`;
}

export default function DscrWowCard({
  spread,
  adsStr,
  setAdsStr,
  annualDebtService,
}: {
  spread: TaxSpread | null;
  adsStr: string;
  setAdsStr: (v: string) => void;
  annualDebtService: number | null;
}) {
  const result = useMemo(() => {
    if (!spread) return null;
    return computeDscr(spread, { annual_debt_service: annualDebtService });
  }, [spread, annualDebtService]);

  if (!spread) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">DSCR</div>
        <div className="text-xs text-muted-foreground">{spread.tax_year ? `TY ${spread.tax_year}` : ""}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">CFADS (Proxy)</div>
          <div className="text-sm font-semibold">{fmtMoney(spread.cfads_proxy ?? spread.ebitda)}</div>
        </div>

        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Annual Debt Service</div>
          <input
            value={adsStr}
            onChange={(e) => setAdsStr(e.target.value)}
            placeholder="e.g., 185000"
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </div>

        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">DSCR</div>
          <div className="text-sm font-semibold">{fmtDscr(result?.dscr ?? null)}</div>
        </div>
      </div>

      {!!result?.flags?.length && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <div className="font-medium">Flags</div>
          <ul className="list-disc pl-4">
            {result.flags.slice(0, 6).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}