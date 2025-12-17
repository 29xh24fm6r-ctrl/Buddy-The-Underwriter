// src/components/deals/TaxReturnWowCard.tsx
"use client";

import React from "react";
import { extractTaxSpreadFromC4 } from "../../lib/finance/tax/extractTaxSpreadFromC4";
import type { TaxSpread } from "../../lib/finance/tax/taxSpreadTypes";

// Minimal v1: tries a few common C4-ish paths, otherwise shows "not available"
export default function TaxReturnWowCard({
  classification,
  c4,
  taxYear,
}: {
  classification: { doc_type: string; confidence: number; tax_year: string | null } | null;
  c4: unknown;
  taxYear: number | null;
}) {
  const taxSpread: TaxSpread = extractTaxSpreadFromC4(c4, taxYear, classification?.doc_type);

  const fmt = (n: number | null) =>
    n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const has1120sExtras = taxSpread.officer_comp !== null || taxSpread.cfads_proxy !== null;

  const tiles: Array<{ label: string; value: number | null }> = [
    { label: "Revenue", value: taxSpread.revenue },
    { label: "EBITDA (Proxy)", value: taxSpread.ebitda },
    { label: "Net Income", value: taxSpread.net_income },
  ];

  if (has1120sExtras) {
    tiles.push({ label: "Officer Comp", value: taxSpread.officer_comp });
    tiles.push({ label: "CFADS (Proxy)", value: taxSpread.cfads_proxy });
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Tax Return Snapshot</div>
        <div className="text-xs text-muted-foreground">
          {taxYear ? `TY ${taxYear}` : classification?.tax_year ? `TY ${classification.tax_year}` : ""}
        </div>
      </div>

      <div className={`grid gap-3 ${has1120sExtras ? "grid-cols-2" : "grid-cols-3"}`}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded border p-3">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="text-sm font-semibold">{fmt(t.value)}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Confidence: {Math.round(taxSpread.confidence * 100)}%
        </div>
        {taxSpread.notes && taxSpread.notes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {taxSpread.notes.join(", ")}
          </div>
        )}
      </div>

      {(taxSpread.revenue === null && taxSpread.net_income === null && taxSpread.ebitda === null) && (
        <div className="mt-3 text-xs text-muted-foreground">
          Tax spread metrics not found yet (v1). Next step: normalize IRS forms into a consistent C4 tax schema.
        </div>
      )}
    </div>
  );
}