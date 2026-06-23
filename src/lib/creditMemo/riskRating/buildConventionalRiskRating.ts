/**
 * Conventional Commercial Risk Rating Model
 *
 * Replaces the narrow DSCR-only scoring model with a multi-factor
 * conventional commercial credit rating that considers repayment capacity,
 * collateral, guarantor support, management, industry, and data quality.
 *
 * Scale (configurable):
 *   1 — Exceptional / Minimal Risk
 *   2 — Strong Pass
 *   3 — Satisfactory Pass
 *   4 — Acceptable Pass / Moderate Risk
 *   5 — Watch / Acceptable with Elevated Monitoring
 *   6 — Special Mention
 *   7 — Substandard
 *   8 — Doubtful / Loss
 *
 * Pure function — no DB, no server-only.
 */

export type RiskGradeScale = {
  grade: number;
  label: string;
  description: string;
};

export const DEFAULT_RISK_SCALE: RiskGradeScale[] = [
  { grade: 1, label: "Exceptional", description: "Minimal risk — superior repayment, collateral, and management" },
  { grade: 2, label: "Strong Pass", description: "Strong credit — well-above-policy coverage and controls" },
  { grade: 3, label: "Satisfactory Pass", description: "Satisfactory — meets all policy criteria with adequate margin" },
  { grade: 4, label: "Acceptable", description: "Acceptable with moderate risk — meets policy but limited margin" },
  { grade: 5, label: "Watch", description: "Acceptable with elevated monitoring — policy-marginal or data gaps" },
  { grade: 6, label: "Special Mention", description: "Potential weakness requiring close attention" },
  { grade: 7, label: "Substandard", description: "Inadequate repayment or protection — loss potential exists" },
  { grade: 8, label: "Doubtful", description: "Full collection improbable — significant loss expected" },
];

export type ConventionalRiskRatingInput = {
  // Quantitative
  dscr: number | null;
  stressedDscr: number | null;
  worstYearDscr: number | null;
  cfadsTrend: "up" | "down" | "flat" | "unknown";
  revenueTrend: "up" | "down" | "flat" | "unknown";
  ltvPct: number | null;
  collateralCoverageRatio: number | null;
  arBorrowingBaseAvailable: boolean;
  guarantorNetWorth: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  grossMarginPct: number | null;

  // Qualitative
  managementYearsExperience: number | null;
  characterScore: number; // 1-5
  gcfComplete: boolean;
  formalDiligenceComplete: boolean;
  customerConcentrationRisk: boolean;
  hasAdverseFindings: boolean;
  financialStatementQuality: "audited" | "reviewed" | "compiled" | "tax_returns" | "internal" | "unknown";
};

export type RiskRatingDriver = {
  factor: string;
  impact: "positive" | "negative" | "neutral" | "cap";
  detail: string;
};

export type ConventionalRiskRating = {
  risk_grade: number;
  risk_grade_label: string;
  risk_grade_scale: string;
  score: number;
  quantitative_score: number;
  qualitative_score: number;
  primary_drivers: RiskRatingDriver[];
  grade_bridge: Array<{
    category: string;
    assessment: string;
    impact: "positive" | "negative" | "neutral" | "cap";
  }>;
  conditions_affecting_grade: string[];
  unresolved_diligence_items: string[];
  policy_notes: string[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function buildConventionalRiskRating(
  input: ConventionalRiskRatingInput,
): ConventionalRiskRating {
  const drivers: RiskRatingDriver[] = [];
  const bridge: ConventionalRiskRating["grade_bridge"] = [];
  const conditions: string[] = [];
  const diligenceItems: string[] = [];
  const policyNotes: string[] = [];

  // ── Quantitative scoring (0-60 points) ──────────────────────────────

  let qScore = 0;

  // DSCR (0-20)
  if (input.dscr !== null) {
    if (input.dscr >= 2.0) { qScore += 20; drivers.push({ factor: "DSCR", impact: "positive", detail: `${input.dscr.toFixed(2)}x — strong repayment capacity` }); }
    else if (input.dscr >= 1.5) { qScore += 16; drivers.push({ factor: "DSCR", impact: "positive", detail: `${input.dscr.toFixed(2)}x — above policy minimum` }); }
    else if (input.dscr >= 1.25) { qScore += 12; drivers.push({ factor: "DSCR", impact: "neutral", detail: `${input.dscr.toFixed(2)}x — meets policy minimum` }); }
    else if (input.dscr >= 1.0) { qScore += 6; drivers.push({ factor: "DSCR", impact: "negative", detail: `${input.dscr.toFixed(2)}x — below policy minimum` }); }
    else { qScore += 0; drivers.push({ factor: "DSCR", impact: "negative", detail: `${input.dscr.toFixed(2)}x — inadequate coverage` }); }
    bridge.push({ category: "Repayment capacity", assessment: `DSCR ${input.dscr.toFixed(2)}x`, impact: input.dscr >= 1.25 ? "positive" : "negative" });
  } else {
    drivers.push({ factor: "DSCR", impact: "negative", detail: "Not computed — material data gap" });
    bridge.push({ category: "Repayment capacity", assessment: "DSCR not available", impact: "negative" });
  }

  // Stressed DSCR (0-10)
  if (input.stressedDscr !== null) {
    if (input.stressedDscr >= 1.25) { qScore += 10; }
    else if (input.stressedDscr >= 1.0) { qScore += 6; }
    else { qScore += 2; drivers.push({ factor: "Stress sensitivity", impact: "negative", detail: `Stressed DSCR ${input.stressedDscr.toFixed(2)}x below 1.0x` }); }
    bridge.push({ category: "Stress resilience", assessment: `Stressed DSCR ${input.stressedDscr.toFixed(2)}x`, impact: input.stressedDscr >= 1.0 ? "positive" : "negative" });
  }

  // Collateral (0-12)
  if (input.arBorrowingBaseAvailable) {
    qScore += 12;
    drivers.push({ factor: "Collateral", impact: "positive", detail: "AR borrowing-base controlled" });
    bridge.push({ category: "Collateral protection", assessment: "AR borrowing base — strong control", impact: "positive" });
  } else if (input.ltvPct !== null && input.ltvPct <= 75) {
    qScore += 10;
    bridge.push({ category: "Collateral protection", assessment: `LTV ${input.ltvPct.toFixed(0)}%`, impact: "positive" });
  } else if (input.ltvPct !== null && input.ltvPct <= 90) {
    qScore += 6;
    bridge.push({ category: "Collateral protection", assessment: `LTV ${input.ltvPct.toFixed(0)}%`, impact: "neutral" });
  } else {
    qScore += 2;
    bridge.push({ category: "Collateral protection", assessment: "Limited or unverified", impact: "negative" });
  }

  // Guarantor support (0-8)
  if (input.guarantorNetWorth !== null && input.guarantorNetWorth > 0) {
    qScore += 8;
    drivers.push({ factor: "Guarantor", impact: "positive", detail: "Strong balance-sheet support" });
    bridge.push({ category: "Guarantor support", assessment: "Strong net worth", impact: "positive" });
  } else {
    bridge.push({ category: "Guarantor support", assessment: "Limited or not available", impact: "neutral" });
  }

  // Liquidity (0-5)
  if (input.currentRatio !== null && input.currentRatio >= 1.5) { qScore += 5; }
  else if (input.currentRatio !== null && input.currentRatio >= 1.0) { qScore += 3; }

  // Leverage (0-5)
  if (input.debtToEquity !== null && input.debtToEquity <= 2.0) { qScore += 5; }
  else if (input.debtToEquity !== null && input.debtToEquity <= 4.0) { qScore += 2; }

  // ── Qualitative scoring (0-40 points) ───────────────────────────────

  let qualScore = 0;

  // Management (0-10)
  if (input.managementYearsExperience !== null && input.managementYearsExperience >= 10) {
    qualScore += 10;
    bridge.push({ category: "Management", assessment: `${input.managementYearsExperience} years experience`, impact: "positive" });
  } else if (input.managementYearsExperience !== null && input.managementYearsExperience >= 5) {
    qualScore += 6;
    bridge.push({ category: "Management", assessment: "Adequate experience", impact: "neutral" });
  } else {
    qualScore += 2;
    bridge.push({ category: "Management", assessment: "Limited documented experience", impact: "negative" });
  }

  // Character (0-8)
  if (input.characterScore >= 4) { qualScore += 8; }
  else if (input.characterScore >= 3) { qualScore += 5; }
  else { qualScore += 0; }

  // Industry/margin (0-8)
  if (input.grossMarginPct !== null && input.grossMarginPct >= 0.30) {
    qualScore += 8;
  } else if (input.grossMarginPct !== null && input.grossMarginPct >= 0.15) {
    qualScore += 4;
    drivers.push({ factor: "Margins", impact: "negative", detail: `Gross margin ${(input.grossMarginPct * 100).toFixed(1)}% — below peer benchmark` });
    bridge.push({ category: "Margins", assessment: "Below peer benchmark", impact: "negative" });
  } else {
    qualScore += 1;
    drivers.push({ factor: "Margins", impact: "negative", detail: "Thin gross margin — sensitivity to input costs" });
    bridge.push({ category: "Margins", assessment: "Thin — elevated sensitivity", impact: "negative" });
  }

  // Trend (0-8)
  if (input.cfadsTrend === "up" && input.revenueTrend === "up") {
    qualScore += 8;
  } else if (input.cfadsTrend === "up" || input.revenueTrend === "up") {
    qualScore += 5;
  } else if (input.cfadsTrend === "down" || input.revenueTrend === "down") {
    qualScore += 0;
    drivers.push({ factor: "Trend", impact: "negative", detail: "Declining revenue or CFADS trend" });
    bridge.push({ category: "Trend", assessment: "Declining", impact: "negative" });
  } else {
    qualScore += 4;
  }

  // Data quality / completeness (0-6)
  if (input.gcfComplete && input.formalDiligenceComplete) {
    qualScore += 6;
  } else {
    if (!input.gcfComplete) {
      qualScore += 1;
      conditions.push("Formal GCF completion or documentation of exception required");
      bridge.push({ category: "GCF/PFS completeness", assessment: "Incomplete", impact: "cap" });
    }
    if (!input.formalDiligenceComplete) {
      qualScore += 1;
      diligenceItems.push("Complete formal adverse media, background, OFAC, and lien searches");
      bridge.push({ category: "Formal diligence", assessment: "Incomplete", impact: "cap" });
    }
  }

  // ── Concentration risk modifier ─────────────────────────────────────
  if (input.customerConcentrationRisk) {
    qualScore = Math.max(0, qualScore - 3);
    drivers.push({ factor: "Concentration", impact: "negative", detail: "Customer concentration risk" });
    conditions.push("Concentration monitoring and reporting required");
  }

  // ── Adverse findings hard floor ─────────────────────────────────────
  if (input.hasAdverseFindings) {
    qualScore = Math.max(0, qualScore - 8);
    drivers.push({ factor: "Adverse findings", impact: "negative", detail: "Adverse research findings require review" });
  }

  // ── Composite ───────────────────────────────────────────────────────
  const totalScore = clamp(qScore + qualScore, 0, 100);

  // Grade mapping
  let grade: number;
  if (totalScore >= 85) grade = 1;
  else if (totalScore >= 75) grade = 2;
  else if (totalScore >= 65) grade = 3;
  else if (totalScore >= 55) grade = 4;
  else if (totalScore >= 45) grade = 5;
  else if (totalScore >= 35) grade = 6;
  else if (totalScore >= 20) grade = 7;
  else grade = 8;

  // ── Caps ────────────────────────────────────────────────────────────
  // Incomplete GCF/diligence caps at grade 4 minimum (Acceptable)
  if (!input.gcfComplete && grade < 4) { grade = 4; policyNotes.push("Rating capped at Acceptable due to incomplete formal GCF"); }
  if (!input.formalDiligenceComplete && grade < 4) { grade = 4; policyNotes.push("Rating capped at Acceptable due to incomplete formal diligence"); }
  // Adverse findings floor at grade 6
  if (input.hasAdverseFindings && grade < 6) { grade = 6; policyNotes.push("Rating floored at Special Mention due to adverse findings"); }
  // No DSCR = minimum grade 6
  if (input.dscr === null && grade < 6) { grade = 6; policyNotes.push("Rating floored at Special Mention — DSCR not available"); }

  const scaleEntry = DEFAULT_RISK_SCALE.find((s) => s.grade === grade) ?? DEFAULT_RISK_SCALE[DEFAULT_RISK_SCALE.length - 1];

  return {
    risk_grade: grade,
    risk_grade_label: scaleEntry.label,
    risk_grade_scale: "Conventional 1–8",
    score: totalScore,
    quantitative_score: qScore,
    qualitative_score: qualScore,
    primary_drivers: drivers,
    grade_bridge: bridge,
    conditions_affecting_grade: conditions,
    unresolved_diligence_items: diligenceItems,
    policy_notes: policyNotes,
  };
}
