// src/lib/finance/underwriting/yoyDeltas.ts

import type { UnderwritingResults } from "./results";

export type YoYDelta = {
  from: number;
  to: number;
  field: "revenue" | "cfads" | "dscr" | "officer_comp";
  delta_abs: number;
  delta_pct: number | null;
};

export function computeYoYDeltas(
  r: UnderwritingResults
): YoYDelta[] {
  const deltas: YoYDelta[] = [];

  const rows = [...r.by_year].sort((a, b) => a.year - b.year);

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];

    const fields: Array<"revenue" | "cfads" | "dscr" | "officer_comp"> = [
      "revenue",
      "cfads",
      "dscr",
      "officer_comp",
    ];

    for (const field of fields) {
      const a = prev[field];
      const b = curr[field];
      if (typeof a !== "number" || typeof b !== "number") continue;

      const delta_abs = b - a;
      const delta_pct = a !== 0 ? delta_abs / Math.abs(a) : null;

      deltas.push({
        from: prev.year,
        to: curr.year,
        field,
        delta_abs,
        delta_pct,
      });
    }
  }

  return deltas;
}