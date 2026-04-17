import "server-only";

/**
 * Phase 90 Part C — Qualitative Assessment (Five Cs framework)
 *
 * Deterministic scoring of five credit dimensions based on structured
 * data already fetched by buildCanonicalCreditMemo. NO LLM calls — pure
 * heuristics over snapshot metrics, ownership entities, BIE research
 * data, and banker overrides.
 *
 * Dimensions (each scored 1-5):
 *   - CHARACTER: trust grade, adverse findings, litigation flags from research
 *   - CAPITAL: net worth + working capital adequacy vs loan amount
 *   - CONDITIONS: industry/market risk from BIE risk indicators + outlook
 *   - MANAGEMENT: principal count, experience, BIE management intelligence
 *   - BUSINESS_MODEL: concentration, seasonality, revenue mix signals
 *
 * Composite score is the simple average of the five dimensions.
 */

import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";
import type { CanonicalCreditMemoV1 } from "./types";

export type QualitativeScore = 1 | 2 | 3 | 4 | 5;
export type QualitativeLabel =
  | "Strong"
  | "Adequate"
  | "Marginal"
  | "Weak"
  | "Insufficient";

export type QualitativeDimension = {
  score: QualitativeScore;
  label: QualitativeLabel;
  basis: string;
  flags: string[];
};

export type QualitativeAssessment = {
  character: QualitativeDimension;
  capital: QualitativeDimension;
  conditions: QualitativeDimension;
  management: QualitativeDimension;
  business_model: QualitativeDimension;
  composite_score: number;
  composite_label: "Strong" | "Adequate" | "Marginal" | "Weak";
  key_strengths: string[];
  key_concerns: string[];
  underwriting_questions: string[];
};

// ---------------------------------------------------------------------------
// Score → label mapping (per-dimension)
// ---------------------------------------------------------------------------

function scoreToLabel(score: QualitativeScore): QualitativeLabel {
  if (score >= 5) return "Strong";
  if (score >= 4) return "Adequate";
  if (score === 3) return "Marginal";
  if (score === 2) return "Weak";
  return "Insufficient";
}

// ---------------------------------------------------------------------------
// Composite → label (uses average of 5 scores)
// ---------------------------------------------------------------------------

function compositeToLabel(avg: number): QualitativeAssessment["composite_label"] {
  if (avg >= 4.3) return "Strong";
  if (avg >= 3.3) return "Adequate";
  if (avg >= 2.3) return "Marginal";
  return "Weak";
}

// ---------------------------------------------------------------------------
// Helpers — safe numeric pulls from the snapshot shape
// ---------------------------------------------------------------------------

function snapshotNumber(
  snapshot: DealFinancialSnapshotV1,
  key: keyof DealFinancialSnapshotV1,
): number | null {
  const slot = (snapshot as any)[key];
  const v = slot?.value_num;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// CHARACTER scoring
// ---------------------------------------------------------------------------

function scoreCharacter(args: {
  research: CanonicalCreditMemoV1["business_industry_analysis"];
  overrides: Record<string, any>;
}): QualitativeDimension {
  const { research, overrides } = args;
  const flags: string[] = [];

  const litigation = research?.litigation_and_risk?.trim().toLowerCase() ?? "";
  const mentionsAdverse = /litig|lawsuit|judgment|default|bankrupt|fraud|investigat/.test(litigation);

  const researchQuality = research?.research_quality_score ?? null;
  const overrideFlag = String(overrides?.character_concerns ?? "").toLowerCase();
  const bankerFlaggedAdverse = /yes|true|adverse|concern/.test(overrideFlag);

  let score: QualitativeScore = 3;
  let basis = "No litigation or adverse findings surfaced; character assumed adequate pending banker diligence.";

  if (bankerFlaggedAdverse) {
    score = 1;
    basis = "Banker flagged character concerns in overrides — requires escalation before approval.";
    flags.push("Banker-flagged character concerns");
  } else if (mentionsAdverse) {
    score = 2;
    basis = "Research surfaced litigation or adverse legal history — requires underwriter review.";
    flags.push("Research references litigation or adverse findings");
  } else if (researchQuality === "Strong") {
    score = 5;
    basis = "Committee-grade research coverage with no adverse findings on principals or entity.";
  } else if (researchQuality === "Moderate") {
    score = 4;
    basis = "Moderate research coverage; no adverse findings surfaced.";
  } else if (researchQuality === "Limited" || !research) {
    score = 3;
    basis = "Limited research coverage — no adverse findings, but diligence not exhaustive.";
    flags.push("Research coverage limited — character diligence incomplete");
  }

  return { score, label: scoreToLabel(score), basis, flags };
}

// ---------------------------------------------------------------------------
// CAPITAL scoring
// ---------------------------------------------------------------------------

function scoreCapital(args: {
  snapshot: DealFinancialSnapshotV1;
  loanAmount: number | null;
}): QualitativeDimension {
  const { snapshot, loanAmount } = args;
  const flags: string[] = [];

  const netWorth = snapshotNumber(snapshot, "net_worth");
  const workingCapital = snapshotNumber(snapshot, "working_capital");
  const currentRatio = snapshotNumber(snapshot, "current_ratio");

  if (netWorth === null || loanAmount === null) {
    return {
      score: 3,
      label: scoreToLabel(3),
      basis: "Net worth or loan amount unavailable — capital adequacy cannot be quantified.",
      flags: ["Capital adequacy data missing"],
    };
  }

  const nwRatio = netWorth / loanAmount;
  let score: QualitativeScore = 3;
  let basis: string;

  if (netWorth < 0) {
    score = 1;
    basis = `Negative net worth ($${Math.round(netWorth).toLocaleString()}) — capital deficit relative to $${Math.round(loanAmount).toLocaleString()} loan request.`;
    flags.push("Negative net worth");
  } else if (nwRatio >= 2.0 && (workingCapital === null || workingCapital > 0)) {
    score = 5;
    basis = `Strong capital position: net worth of $${Math.round(netWorth).toLocaleString()} is ${nwRatio.toFixed(1)}x the loan amount with positive working capital.`;
  } else if (nwRatio >= 1.0) {
    score = 4;
    basis = `Adequate capital: net worth of $${Math.round(netWorth).toLocaleString()} (${nwRatio.toFixed(1)}x loan amount).`;
  } else if (nwRatio >= 0.5) {
    score = 3;
    basis = `Moderate capital: net worth of $${Math.round(netWorth).toLocaleString()} covers ${(nwRatio * 100).toFixed(0)}% of the loan amount.`;
  } else {
    score = 2;
    basis = `Thin capital: net worth of $${Math.round(netWorth).toLocaleString()} covers only ${(nwRatio * 100).toFixed(0)}% of the loan amount.`;
    flags.push("Net worth below 50% of loan amount");
  }

  if (workingCapital !== null && workingCapital < 0 && score > 2) {
    score = (score - 1) as QualitativeScore;
    flags.push(`Negative working capital ($${Math.round(workingCapital).toLocaleString()})`);
  }

  if (currentRatio !== null && currentRatio < 1.0 && score > 2) {
    flags.push(`Current ratio below 1.0x (${currentRatio.toFixed(2)}x)`);
  }

  return { score, label: scoreToLabel(score), basis, flags };
}

// ---------------------------------------------------------------------------
// CONDITIONS scoring (industry + market)
// ---------------------------------------------------------------------------

function scoreConditions(args: {
  research: CanonicalCreditMemoV1["business_industry_analysis"];
}): QualitativeDimension {
  const { research } = args;
  const flags: string[] = [];

  if (!research) {
    return {
      score: 3,
      label: scoreToLabel(3),
      basis: "Industry research unavailable — industry conditions assessed as neutral pending diligence.",
      flags: ["Industry research unavailable"],
    };
  }

  const indicators = Array.isArray(research.risk_indicators) ? research.risk_indicators : [];
  const highs = indicators.filter((r) => r.level === "high");
  const mediums = indicators.filter((r) => r.level === "medium");

  const outlook = (research.three_five_year_outlook ?? "").toLowerCase();
  const outlookDeclining = /declin|contract|shrink|obsolet|sunset/.test(outlook);
  const outlookGrowing = /grow|expand|tailwind|favor|strong/.test(outlook);

  let score: QualitativeScore = 3;
  let basis: string;

  if (highs.length > 0) {
    score = 2;
    basis = `Industry/market research flags ${highs.length} high-severity risk indicator(s): ${highs.map((r) => r.category).slice(0, 3).join(", ")}.`;
    flags.push(...highs.map((r) => `High risk: ${r.category}`));
  } else if (outlookDeclining) {
    score = 2;
    basis = "Three-to-five-year industry outlook is declining or contracting.";
    flags.push("Declining industry outlook");
  } else if (mediums.length >= 3) {
    score = 3;
    basis = `Multiple medium-severity risk indicators (${mediums.length}) in industry/market research.`;
    flags.push(...mediums.slice(0, 2).map((r) => `Medium risk: ${r.category}`));
  } else if (mediums.length >= 1) {
    score = 4;
    basis = `Industry conditions adequate with ${mediums.length} medium-severity indicator(s) to monitor.`;
  } else if (outlookGrowing) {
    score = 5;
    basis = "No material risk indicators; three-to-five-year industry outlook is growing or favorable.";
  } else {
    score = 4;
    basis = "Industry conditions stable; no material risk indicators surfaced.";
  }

  return { score, label: scoreToLabel(score), basis, flags };
}

// ---------------------------------------------------------------------------
// MANAGEMENT scoring
// ---------------------------------------------------------------------------

function scoreManagement(args: {
  ownerEntities: any[];
  research: CanonicalCreditMemoV1["business_industry_analysis"];
  overrides: Record<string, any>;
}): QualitativeDimension {
  const { ownerEntities, research, overrides } = args;
  const flags: string[] = [];

  const principalCount = ownerEntities.length;
  const yearsRaw = ownerEntities
    .map((o) => Number(o?.years_experience ?? o?.experience_years ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const totalYears = yearsRaw.reduce((sum, y) => sum + y, 0);
  const avgYears = yearsRaw.length > 0 ? totalYears / yearsRaw.length : 0;

  const mgmtIntel = (research?.management_intelligence ?? "").toLowerCase();
  const mgmtOverride = (overrides?.management_assessment ?? "").toLowerCase();
  const bankerFlaggedStrong = /strong|experienced|seasoned/.test(mgmtOverride);
  const bankerFlaggedWeak = /weak|first[- ]time|inexperienced|new/.test(mgmtOverride);

  let score: QualitativeScore = 3;
  let basis: string;

  if (principalCount === 0) {
    score = 2;
    basis = "No principal/ownership entities on file — management depth undocumented.";
    flags.push("No principals documented");
  } else if (bankerFlaggedStrong || (principalCount >= 2 && avgYears >= 10)) {
    score = 5;
    basis =
      principalCount >= 2
        ? `Multiple experienced principals (${principalCount} entities, avg ${avgYears.toFixed(0)} years).`
        : "Banker-documented strong management track record.";
  } else if (avgYears >= 5 || principalCount >= 2) {
    score = 4;
    basis = `Owner-operator(s) with relevant experience (${principalCount} entity${principalCount !== 1 ? "ies" : ""}, avg ${avgYears.toFixed(0)} years).`;
  } else if (bankerFlaggedWeak || avgYears > 0) {
    score = 3;
    basis = "Single owner-operator with limited documented experience.";
    flags.push("Limited documented management experience");
  } else {
    score = 2;
    basis = "Management experience undocumented; first-time borrower risk until diligence completes.";
    flags.push("Management experience undocumented");
  }

  if (mgmtIntel && /succession|key[- ]person|single point/.test(mgmtIntel)) {
    flags.push("Key-person / succession risk noted in research");
  }

  return { score, label: scoreToLabel(score), basis, flags };
}

// ---------------------------------------------------------------------------
// BUSINESS MODEL scoring
// ---------------------------------------------------------------------------

function scoreBusinessModel(args: {
  naicsCode: string | null;
  overrides: Record<string, any>;
  research: CanonicalCreditMemoV1["business_industry_analysis"];
}): QualitativeDimension {
  const { naicsCode, overrides, research } = args;
  const flags: string[] = [];

  const revenueMix = String(overrides?.revenue_mix ?? "").toLowerCase();
  const seasonality = String(overrides?.seasonality ?? "").toLowerCase();
  const competitive = (research?.competitive_positioning ?? "").toLowerCase();

  const hasConcentrationRisk = /concentrat|single customer|top.*customer.*>|majority of revenue/.test(revenueMix)
    || /concentrat/.test(competitive);
  const isSeasonal =
    seasonality.length > 0 && !/no seasonality|year[- ]round|steady/.test(seasonality)
    && /season|peak|holiday|summer|winter|q[1-4] heavy/.test(seasonality);
  const isDiversified = /diversif|multiple|broad|recurring|subscription|contract/.test(revenueMix);

  let score: QualitativeScore = 3;
  let basis: string;

  if (hasConcentrationRisk) {
    score = 2;
    basis = "Revenue concentration risk flagged in banker overrides or research.";
    flags.push("Customer/revenue concentration risk");
  } else if (isSeasonal && !isDiversified) {
    score = 3;
    basis = `Seasonal revenue pattern (${seasonality.slice(0, 60)}) — working capital seasonality to monitor.`;
    flags.push("Seasonal cash flow pattern");
  } else if (isDiversified) {
    score = 4;
    basis = "Diversified revenue mix reduces single-customer / single-segment concentration risk.";
  } else if (!revenueMix && !seasonality) {
    score = 3;
    basis = "Revenue mix and seasonality profile undocumented — requires banker input.";
    flags.push("Revenue mix undocumented");
  } else {
    score = 4;
    basis = "No material concentration or seasonality risk signals.";
  }

  if (!naicsCode || naicsCode === "999999") {
    flags.push("NAICS code missing or unverified");
    if (score > 2) score = (score - 1) as QualitativeScore;
  }

  return { score, label: scoreToLabel(score), basis, flags };
}

// ---------------------------------------------------------------------------
// Aggregate + key strengths/concerns
// ---------------------------------------------------------------------------

export function buildQualitativeAssessment(args: {
  snapshot: DealFinancialSnapshotV1;
  ownerEntities: any[];
  research: CanonicalCreditMemoV1["business_industry_analysis"];
  overrides: Record<string, any>;
  loanAmount: number | null;
  naicsCode: string | null;
}): QualitativeAssessment {
  const character = scoreCharacter({ research: args.research, overrides: args.overrides });
  const capital = scoreCapital({ snapshot: args.snapshot, loanAmount: args.loanAmount });
  const conditions = scoreConditions({ research: args.research });
  const management = scoreManagement({
    ownerEntities: args.ownerEntities,
    research: args.research,
    overrides: args.overrides,
  });
  const businessModel = scoreBusinessModel({
    naicsCode: args.naicsCode,
    overrides: args.overrides,
    research: args.research,
  });

  const dims = [character, capital, conditions, management, businessModel];
  const compositeScore =
    dims.reduce((sum, d) => sum + d.score, 0) / dims.length;
  const compositeLabel = compositeToLabel(compositeScore);

  // Top 3 strengths: pick dims with score >= 4, sorted by score desc.
  const strengthPool = [
    { dim: "Character", d: character },
    { dim: "Capital", d: capital },
    { dim: "Conditions", d: conditions },
    { dim: "Management", d: management },
    { dim: "Business Model", d: businessModel },
  ];
  const keyStrengths = strengthPool
    .filter((x) => x.d.score >= 4)
    .sort((a, b) => b.d.score - a.d.score)
    .slice(0, 3)
    .map((x) => `${x.dim}: ${x.d.basis}`);

  // Top 3 concerns: pick dims with score <= 3, sorted by score asc,
  // plus any flagged items.
  const concernPool = strengthPool
    .filter((x) => x.d.score <= 3)
    .sort((a, b) => a.d.score - b.d.score)
    .slice(0, 3)
    .map((x) => `${x.dim}: ${x.d.basis}`);
  const keyConcerns = concernPool;

  // Underwriting questions from BIE v3
  const underwritingQuestions = Array.isArray(args.research?.underwriting_questions)
    ? (args.research!.underwriting_questions as string[]).slice(0, 5)
    : [];

  return {
    character,
    capital,
    conditions,
    management,
    business_model: businessModel,
    composite_score: Number(compositeScore.toFixed(2)),
    composite_label: compositeLabel,
    key_strengths: keyStrengths,
    key_concerns: keyConcerns,
    underwriting_questions: underwritingQuestions,
  };
}
