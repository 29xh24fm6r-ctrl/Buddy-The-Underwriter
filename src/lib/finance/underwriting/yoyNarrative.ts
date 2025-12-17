// src/lib/finance/underwriting/yoyNarrative.ts

import type { YoYDelta } from "./yoyDeltas";

export function generateYoYCommentary(deltas: YoYDelta[]): string[] {
  const lines: string[] = [];

  deltas.forEach((d) => {
    if (Math.abs(d.delta_pct ?? 0) < 0.05) return;

    const pct = d.delta_pct !== null
      ? `${Math.round(d.delta_pct * 100)}%`
      : "materially";

    const direction = d.delta_abs > 0 ? "increased" : "declined";

    lines.push(
      `${d.field.toUpperCase()} ${direction} ${pct} from tax year ${d.from} to ${d.to}.`
    );
  });

  return lines;
}