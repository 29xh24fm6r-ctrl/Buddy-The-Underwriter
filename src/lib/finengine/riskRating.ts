/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 4: dual risk rating.
 *
 * Produces TWO dimensions, per modern two-dimensional rating practice:
 *   - PD  (obligor)  — probability of default from the five C's (capacity,
 *                      capital/leverage, conditions/trend, character, plus
 *                      liquidity), forward-looking.
 *   - LGD (facility) — loss given default, collateral- and lien-driven.
 * These map to the interagency classification (Pass / Special Mention /
 * Substandard / Doubtful / Loss). Output is a RECOMMENDED grade + full
 * rationale; the banker override is a documented, separate field. Omega may
 * narrate the rationale — it never sets the grade (NG1).
 *
 * Thresholds resolve from the policy registry (NG4). Pure — no DB.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type Classification = "PASS" | "SPECIAL_MENTION" | "SUBSTANDARD" | "DOUBTFUL" | "LOSS";

export type ObligorSignals = {
  dscr: number | null; // current global DSCR
  projectedDscr?: number | null; // forward-looking
  leverage: number | null; // debt / EBITDA
  currentRatio?: number | null;
  /** Negative trend flag (deteriorating performance). */
  deterioratingTrend?: boolean;
  /** Material character/management concern. */
  characterConcern?: boolean;
};

export type FacilitySignals = {
  /** Collateral coverage = discounted collateral value ÷ loan exposure. */
  collateralCoverage: number | null;
  /** Lien position: 1 = first, 2 = second, etc.; null = unsecured. */
  lienPosition?: number | null;
  /** Guarantor support strength (0..1). */
  guarantorSupport?: number | null;
};

export type PdResult = { grade: number; pd: number; drivers: string[] };
export type LgdResult = { lgd: number; drivers: string[] };

export type RiskRating = {
  pd: PdResult;
  lgd: LgdResult;
  classification: Classification;
  /** 1 (strongest) … 9 (loss) regulatory-aligned obligor grade. */
  recommendedGrade: number;
  rationale: string[];
  /** Documented banker override (never set by Omega). */
  override?: { grade: number; classification: Classification; bankerId: string; rationale: string };
};

/** PD: forward-looking obligor grade from the five C's. */
export function computePD(s: ObligorSignals, ctx?: PolicyContext): PdResult {
  const floor = resolvePolicy("dscr_floor", ctx).effective ?? 1.15;
  const drivers: string[] = [];
  // Use the worst of current and projected DSCR (forward-looking downgrade).
  const dscrValues = [s.dscr, s.projectedDscr].filter((v): v is number => v != null);
  const dscr = dscrValues.length ? Math.min(...dscrValues) : null;
  if (s.projectedDscr != null && s.dscr != null && s.projectedDscr < s.dscr) {
    drivers.push("Forward-looking: projected DSCR below current — graded on the projection.");
  }

  let grade: number;
  if (dscr == null) {
    grade = 6;
    drivers.push("DSCR unavailable — conservative watch grade.");
  } else if (dscr >= floor * 1.5) {
    grade = 2;
  } else if (dscr >= floor * 1.2) {
    grade = 3;
  } else if (dscr >= floor) {
    grade = 4;
  } else if (dscr >= 1.0) {
    grade = 6; // below policy floor but still covers — special mention
    drivers.push(`DSCR ${dscr.toFixed(2)}x below policy floor ${floor.toFixed(2)}x but ≥ 1.00x.`);
  } else if (dscr >= 0.9) {
    grade = 7;
    drivers.push(`DSCR ${dscr.toFixed(2)}x < 1.00x — cannot fully service debt.`);
  } else {
    grade = 8;
    drivers.push(`DSCR ${dscr.toFixed(2)}x materially below 1.00x.`);
  }

  // Capital / leverage overlay.
  const levMax = resolvePolicy("leverage_max", ctx).effective ?? 4.5;
  if (s.leverage != null && s.leverage > levMax) {
    grade += 1;
    drivers.push(`Leverage ${s.leverage.toFixed(1)}x exceeds ${levMax.toFixed(1)}x cap.`);
  }
  if (s.currentRatio != null && s.currentRatio < 1.0) {
    grade += 1;
    drivers.push("Current ratio < 1.0 — weak liquidity.");
  }
  if (s.deterioratingTrend) {
    grade += 1;
    drivers.push("Deteriorating performance trend.");
  }
  if (s.characterConcern) {
    grade += 1;
    drivers.push("Material character/management concern.");
  }
  grade = Math.max(1, Math.min(9, grade));

  // Approximate PD from grade (monotonic illustrative mapping).
  const pdByGrade = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.06, 0.15, 0.4, 1.0];
  return { grade, pd: pdByGrade[Math.min(grade, 9) - 1], drivers };
}

/** LGD: facility loss severity from collateral coverage + lien + guarantor support. */
export function computeLGD(f: FacilitySignals): LgdResult {
  const drivers: string[] = [];
  const cov = f.collateralCoverage;
  let lgd: number;
  if (cov == null) {
    lgd = 0.75;
    drivers.push("No collateral coverage data — high LGD assumed.");
  } else if (cov >= 1.25) {
    lgd = 0.2;
  } else if (cov >= 1.0) {
    lgd = 0.4;
  } else if (cov >= 0.75) {
    lgd = 0.6;
  } else {
    lgd = 0.85;
    drivers.push(`Collateral coverage ${cov.toFixed(2)}x < 0.75x — severe expected loss.`);
  }
  if (f.lienPosition != null && f.lienPosition > 1) {
    lgd = Math.min(1, lgd + 0.1);
    drivers.push(`Junior lien (position ${f.lienPosition}) raises LGD.`);
  }
  if (f.guarantorSupport != null && f.guarantorSupport > 0) {
    lgd = Math.max(0, lgd - 0.1 * f.guarantorSupport);
    drivers.push("Guarantor support reduces LGD.");
  }
  return { lgd: Math.round(lgd * 100) / 100, drivers };
}

function classify(grade: number, lgd: number): Classification {
  if (grade <= 5) return "PASS";
  if (grade === 6) return "SPECIAL_MENTION";
  if (grade === 7) return "SUBSTANDARD";
  if (grade === 8) return lgd >= 0.6 ? "DOUBTFUL" : "SUBSTANDARD";
  return "LOSS";
}

/** Combine PD + LGD into the recommended grade and interagency classification. */
export function rateRisk(obligor: ObligorSignals, facility: FacilitySignals, ctx?: PolicyContext): RiskRating {
  const pd = computePD(obligor, ctx);
  const lgd = computeLGD(facility);
  const classification = classify(pd.grade, lgd.lgd);
  return {
    pd,
    lgd,
    classification,
    recommendedGrade: pd.grade,
    rationale: [
      `Obligor grade ${pd.grade} (PD ≈ ${(pd.pd * 100).toFixed(1)}%).`,
      `Facility LGD ≈ ${(lgd.lgd * 100).toFixed(0)}%.`,
      `Interagency classification: ${classification}.`,
      ...pd.drivers,
      ...lgd.drivers,
      "Recommended grade is deterministic; any banker override is documented separately. Advisory narration must not alter the grade (NG1).",
    ],
  };
}
