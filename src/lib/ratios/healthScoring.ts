/**
 * Phase 56 — Health Score Computation
 *
 * 0–100 composite from four equally-weighted 0–25 components.
 * Pure, deterministic.
 */

export type HealthScore = {
  composite: number;
  profitability: number;
  liquidity: number;
  leverage: number;
  efficiency: number;
  grades: {
    profitability: string;
    liquidity: string;
    leverage: string;
    efficiency: string;
    overall: string;
  };
};

function scoreToGrade(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.9) return "A";
  if (pct >= 0.8) return "B";
  if (pct >= 0.7) return "C";
  if (pct >= 0.5) return "D";
  return "F";
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export type RatioInputs = {
  grossMargin?: number | null;
  netMargin?: number | null;
  roa?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
  debtToEquity?: number | null;
  dscr?: number | null;
  interestCoverage?: number | null;
  dso?: number | null;
  cashConversionCycle?: number | null;
  assetTurnover?: number | null;
};

export type BenchmarkInputs = {
  grossMargin?: number | null;
  netMargin?: number | null;
  currentRatio?: number | null;
  dso?: number | null;
};

export function computeHealthScore(
  ratios: RatioInputs,
  benchmarks?: BenchmarkInputs,
): HealthScore {
  // Profitability (0-25)
  let profitability = 0;
  if (ratios.grossMargin != null) profitability += clamp(ratios.grossMargin * 30, 0, 8); // 26%+ gross = ~8pts
  if (ratios.netMargin != null) profitability += clamp(ratios.netMargin * 50, 0, 8); // 16%+ net = ~8pts
  if (ratios.roa != null) profitability += clamp(ratios.roa * 80, 0, 9); // 11%+ ROA = ~9pts
  profitability = clamp(Math.round(profitability), 0, 25);

  // Liquidity (0-25)
  let liquidity = 0;
  if (ratios.currentRatio != null) liquidity += clamp(ratios.currentRatio * 6, 0, 13); // 2.0+ = ~12pts
  if (ratios.quickRatio != null) liquidity += clamp(ratios.quickRatio * 8, 0, 12); // 1.5+ = ~12pts
  liquidity = clamp(Math.round(liquidity), 0, 25);

  // Leverage (0-25) — lower is better
  let leverage = 25;
  if (ratios.debtToEquity != null) {
    leverage -= clamp(ratios.debtToEquity * 3, 0, 10); // High D/E penalizes
  }
  if (ratios.dscr != null) {
    leverage += clamp((ratios.dscr - 1.0) * 10, -5, 5); // DSCR bonus/penalty
  }
  leverage = clamp(Math.round(leverage), 0, 25);

  // Efficiency (0-25) — benchmark-relative if available
  let efficiency = 12; // baseline
  if (ratios.dso != null && benchmarks?.dso != null) {
    const gap = benchmarks.dso - ratios.dso; // positive = better than benchmark
    efficiency += clamp(gap / 5, -6, 6);
  }
  if (ratios.assetTurnover != null) {
    efficiency += clamp((ratios.assetTurnover - 0.5) * 5, -6, 7);
  }
  efficiency = clamp(Math.round(efficiency), 0, 25);

  const composite = profitability + liquidity + leverage + efficiency;

  return {
    composite,
    profitability,
    liquidity,
    leverage,
    efficiency,
    grades: {
      profitability: scoreToGrade(profitability, 25),
      liquidity: scoreToGrade(liquidity, 25),
      leverage: scoreToGrade(leverage, 25),
      efficiency: scoreToGrade(efficiency, 25),
      overall: scoreToGrade(composite, 100),
    },
  };
}
