/**
 * Phase 56 — Altman Z''-Score for Private Companies
 *
 * Modified formula (no market cap component).
 * Pure, deterministic.
 */

export type AltmanInput = {
  workingCapital: number;
  totalAssets: number;
  retainedEarnings: number;
  ebit: number;
  bookValueEquity: number;
  totalLiabilities: number;
};

export type AltmanResult = {
  score: number;
  zone: "safe" | "grey" | "distress";
  interpretation: string;
};

export function computeAltmanZScore(params: AltmanInput): AltmanResult {
  if (params.totalAssets === 0 || params.totalLiabilities === 0) {
    return { score: 0, zone: "distress", interpretation: "Insufficient data to compute Z-Score." };
  }

  const x1 = params.workingCapital / params.totalAssets;
  const x2 = params.retainedEarnings / params.totalAssets;
  const x3 = params.ebit / params.totalAssets;
  const x4 = params.bookValueEquity / params.totalLiabilities;

  const score = 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4;
  const rounded = Math.round(score * 100) / 100;

  let zone: AltmanResult["zone"];
  let interpretation: string;

  if (rounded > 2.6) {
    zone = "safe";
    interpretation = `Your Z-Score of ${rounded.toFixed(2)} places you in the 'safe zone,' indicating strong financial stability.`;
  } else if (rounded > 1.1) {
    zone = "grey";
    interpretation = `Your Z-Score of ${rounded.toFixed(2)} places you in the 'grey zone,' indicating moderate financial stability with some areas to watch. A Z-Score above 2.6 would move you into the 'safe zone.'`;
  } else {
    zone = "distress";
    interpretation = `Your Z-Score of ${rounded.toFixed(2)} indicates financial stress. Focus on improving working capital and profitability to strengthen your position.`;
  }

  return { score: rounded, zone, interpretation };
}
