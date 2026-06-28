/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 3b: Altman distress scores (private variants).
 *
 * Coefficients embedded verbatim (academic model constants). Zone boundaries are
 * resolved from the policy registry so an institution may override them (and so
 * this computation file carries no hardcoded policy literal — NG3 / guard G1).
 *
 * X1 = working capital / total assets · X2 = retained earnings / total assets ·
 * X3 = EBIT / total assets. Total assets should exclude intangibles by convention
 * (caller's responsibility; noted in `inputs`).
 *
 * Pure — no DB.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

const z = (v: number | null | undefined): number => (v == null ? 0 : v);
const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);

export type AltmanZone = "safe" | "gray" | "distress" | "unknown";

export type AltmanResult = {
  metric: "ALTMAN_Z_PRIME" | "ALTMAN_Z_DOUBLE_PRIME";
  score: number | null;
  zone: AltmanZone;
  components: Record<string, number | null>;
  inputs: Record<string, number>;
  explanation: string;
};

export type AltmanInputs = {
  workingCapital: number | null;
  retainedEarnings: number | null;
  ebit: number | null;
  totalAssets: number | null;
  bookEquity: number | null;
  totalLiabilities: number | null;
  sales?: number | null; // Z′ only
};

function zoneFor(score: number | null, safe: number, distress: number): AltmanZone {
  if (score == null) return "unknown";
  if (score > safe) return "safe";
  if (score < distress) return "distress";
  return "gray";
}

/** Altman Z′ — private manufacturing. >2.90 safe · 1.23–2.90 gray · <1.23 distress. */
export function altmanZPrime(i: AltmanInputs, ctx?: PolicyContext): AltmanResult {
  const ta = z(i.totalAssets);
  const x1 = ta === 0 ? null : z(i.workingCapital) / ta;
  const x2 = ta === 0 ? null : z(i.retainedEarnings) / ta;
  const x3 = ta === 0 ? null : z(i.ebit) / ta;
  const x4 = div(z(i.bookEquity), z(i.totalLiabilities)); // book equity / total liabilities
  const x5 = ta === 0 ? null : z(i.sales) / ta; // sales / total assets
  const parts = [x1, x2, x3, x4, x5];
  const score = parts.some((p) => p == null)
    ? null
    : 0.717 * x1! + 0.847 * x2! + 3.107 * x3! + 0.42 * x4! + 0.998 * x5!;
  const safe = (resolvePolicy("altman_zprime_safe", ctx).effective as number) ?? 2.9;
  const distress = (resolvePolicy("altman_zprime_distress", ctx).effective as number) ?? 1.23;
  return {
    metric: "ALTMAN_Z_PRIME",
    score,
    zone: zoneFor(score, safe, distress),
    components: { "0.717*X1": x1 == null ? null : 0.717 * x1, "0.847*X2": x2 == null ? null : 0.847 * x2, "3.107*X3": x3 == null ? null : 3.107 * x3, "0.420*X4": x4 == null ? null : 0.42 * x4, "0.998*X5": x5 == null ? null : 0.998 * x5 },
    inputs: { workingCapital: z(i.workingCapital), retainedEarnings: z(i.retainedEarnings), ebit: z(i.ebit), totalAssets: ta, bookEquity: z(i.bookEquity), totalLiabilities: z(i.totalLiabilities), sales: z(i.sales) },
    explanation: "Z′ = 0.717·X1 + 0.847·X2 + 3.107·X3 + 0.420·(equity/liabilities) + 0.998·(sales/assets). Private manufacturing.",
  };
}

/** Altman Z″ — private non-manufacturing / service. >2.60 safe · 1.10–2.60 gray · <1.10 distress. */
export function altmanZDoublePrime(i: AltmanInputs, ctx?: PolicyContext): AltmanResult {
  const ta = z(i.totalAssets);
  const x1 = ta === 0 ? null : z(i.workingCapital) / ta;
  const x2 = ta === 0 ? null : z(i.retainedEarnings) / ta;
  const x3 = ta === 0 ? null : z(i.ebit) / ta;
  const x4 = div(z(i.bookEquity), z(i.totalLiabilities));
  const parts = [x1, x2, x3, x4];
  const score = parts.some((p) => p == null) ? null : 6.56 * x1! + 3.26 * x2! + 6.72 * x3! + 1.05 * x4!;
  const safe = (resolvePolicy("altman_zdoubleprime_safe", ctx).effective as number) ?? 2.6;
  const distress = (resolvePolicy("altman_zdoubleprime_distress", ctx).effective as number) ?? 1.1;
  return {
    metric: "ALTMAN_Z_DOUBLE_PRIME",
    score,
    zone: zoneFor(score, safe, distress),
    components: { "6.56*X1": x1 == null ? null : 6.56 * x1, "3.26*X2": x2 == null ? null : 3.26 * x2, "6.72*X3": x3 == null ? null : 6.72 * x3, "1.05*X4": x4 == null ? null : 1.05 * x4 },
    inputs: { workingCapital: z(i.workingCapital), retainedEarnings: z(i.retainedEarnings), ebit: z(i.ebit), totalAssets: ta, bookEquity: z(i.bookEquity), totalLiabilities: z(i.totalLiabilities) },
    explanation: "Z″ = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·(equity/liabilities). Private non-manufacturing / service.",
  };
}
