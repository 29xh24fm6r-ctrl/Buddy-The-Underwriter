/**
 * Completion Gate — deterministic trust evaluation for BIE research missions.
 *
 * A research mission is not "complete" just because the process finished.
 * It receives a trust grade based on measurable quality criteria.
 *
 * Trust grades:
 *   committee_grade        — meets all thresholds; safe for committee consumption
 *   preliminary            — meets minimum bar; suitable for internal use / initial review
 *   manual_review_required — significant gaps; human verification needed before committee
 *   research_failed        — critical failures; do not surface to banker without re-run
 */

import type { BIEResult, EntityLock } from "./buddyIntelligenceEngine";
import {
  computeSourceQualityScore,
  classifySourceUrl,
  SECTION_SOURCE_REQUIREMENTS,
  type SourceType,
} from "./sourcePolicy";

export type TrustGrade =
  | "committee_grade"
  | "preliminary"
  | "manual_review_required"
  | "research_failed";

export type GateCheckResult = {
  gate_id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  reason: string;
  severity: "error" | "warn" | "info";
};

export type CompletionGateResult = {
  trust_grade: TrustGrade;
  gate_passed: boolean;
  quality_score: number;  // 0–100 computed score
  checks: GateCheckResult[];
  threads_succeeded: number;
  threads_failed: number;
  entity_confidence: number;
  principals_confirmed: number;
  principals_unconfirmed: number;
  source_count: number;
  source_quality_score: number;
  contradictions_found: number;
  underwriting_questions_found: number;
  evaluated_at: string;
};

// Thresholds for trust grade assignment
const THRESHOLDS = {
  committee_grade: {
    min_threads_succeeded: 4,
    min_entity_confidence: 0.70,
    min_source_count: 10,
    min_source_quality_score: 0.50,
    max_unconfirmed_principals_pct: 0.0,  // 0% — all principals must be confirmed
    require_synthesis: true,
    require_contradictions: true,
  },
  preliminary: {
    min_threads_succeeded: 3,
    min_entity_confidence: 0.50,
    min_source_count: 5,
    min_source_quality_score: 0.35,
    max_unconfirmed_principals_pct: 0.5,  // 50% unconfirmed still passes as preliminary
    require_synthesis: true,
    require_contradictions: false,
  },
};

export function evaluateCompletionGate(
  bieResult: BIEResult,
  missionId: string,
  opts?: { naicsCode?: string | null },
): CompletionGateResult {
  const checks: GateCheckResult[] = [];

  // ── Gate 0 (Phase 80): NAICS Placeholder Guard ──────────────────────────
  const naics = opts?.naicsCode ?? null;
  const naicsIsPlaceholder = !naics || naics === "999999";
  if (naicsIsPlaceholder) {
    checks.push({
      gate_id: "naics_guard",
      label: "Industry Classification",
      status: "warn",
      reason: naics === "999999"
        ? "NAICS 999999 (placeholder) — industry research may be unreliable. Max trust: preliminary."
        : "NAICS not provided — industry research may be unreliable.",
      severity: "warn",
    });
  }

  // ── Gate 1: Entity Lock ──────────────────────────────────────────────────
  const entityConfidence = bieResult.entity_lock?.entity_confidence ?? 0;
  const entityConfirmed = bieResult.entity_confirmed;

  checks.push({
    gate_id: "entity_lock",
    label: "Entity Identity Lock",
    status: entityConfidence >= 0.70 ? "pass" : entityConfidence >= 0.50 ? "warn" : "fail",
    reason: entityConfidence >= 0.70
      ? `Entity confirmed: "${bieResult.entity_lock?.confirmed_name}" (${Math.round(entityConfidence * 100)}% confidence)`
      : entityConfidence >= 0.50
        ? `Entity partially confirmed (${Math.round(entityConfidence * 100)}% confidence) — manual verification recommended`
        : `Entity could not be confirmed (${Math.round(entityConfidence * 100)}% confidence) — research may cover wrong entity`,
    severity: entityConfidence < 0.50 ? "error" : entityConfidence < 0.70 ? "warn" : "info",
  });

  // ── Gate 2: Thread Coverage ───────────────────────────────────────────────
  const coreThreads = [
    bieResult.borrower,
    bieResult.management,
    bieResult.competitive,
    bieResult.market,
    bieResult.industry,
    bieResult.transaction,
  ];
  const threadsSucceeded = coreThreads.filter(Boolean).length;
  const threadsFailed = coreThreads.filter((t) => t === null).length;

  checks.push({
    gate_id: "thread_coverage",
    label: "Research Thread Coverage",
    status: threadsSucceeded >= 5 ? "pass" : threadsSucceeded >= 3 ? "warn" : "fail",
    reason: `${threadsSucceeded}/6 research threads completed${threadsFailed > 0 ? ` (${threadsFailed} failed: ${getMissingThreads(bieResult).join(", ")})` : ""}`,
    severity: threadsSucceeded < 3 ? "error" : threadsSucceeded < 5 ? "warn" : "info",
  });

  // ── Gate 3: Source Diversity ──────────────────────────────────────────────
  const allSourceUrls = bieResult.sources_used ?? [];
  const sourceQuality = computeSourceQualityScore(allSourceUrls);
  const primarySources = allSourceUrls.filter((url) => {
    const t = classifySourceUrl(url);
    return ["court_record", "regulatory_filing", "government_data", "company_primary",
            "trade_publication", "news_primary", "market_research"].includes(t);
  }).length;

  checks.push({
    gate_id: "source_diversity",
    label: "Source Quality and Diversity",
    status: sourceQuality >= 0.50 && allSourceUrls.length >= 10 ? "pass"
           : sourceQuality >= 0.35 && allSourceUrls.length >= 5 ? "warn" : "fail",
    reason: `${allSourceUrls.length} sources (${primarySources} primary/institutional), quality score ${Math.round(sourceQuality * 100)}%`,
    severity: allSourceUrls.length < 5 ? "error" : sourceQuality < 0.35 ? "warn" : "info",
  });

  // ── Gate 4: Management Validation ────────────────────────────────────────
  const profiles = bieResult.management?.principal_profiles ?? [];
  const confirmedCount = profiles.filter((p) => p.identity_confirmed).length;
  const unconfirmedCount = profiles.filter((p) => !p.identity_confirmed).length;
  const mgmtValidated = bieResult.synthesis?.management_profiles_validated ?? false;

  checks.push({
    gate_id: "management_validation",
    label: "Management Profile Validation",
    status: profiles.length === 0 ? "warn"
           : confirmedCount === profiles.length ? "pass"
           : unconfirmedCount <= profiles.length * 0.5 ? "warn" : "fail",
    reason: profiles.length === 0
      ? "No ownership entities provided — management research not possible"
      : `${confirmedCount}/${profiles.length} principals confirmed; synthesis validation: ${mgmtValidated ? "passed" : "FAILED"}`,
    severity: profiles.length > 0 && !mgmtValidated ? "error"
             : unconfirmedCount > profiles.length * 0.5 ? "warn" : "info",
  });

  // ── Gate 5: Synthesis Completion ─────────────────────────────────────────
  const synthesis = bieResult.synthesis;
  const contradictionsFound = synthesis?.contradictions_and_uncertainties?.length ?? 0;
  const questionsFound = synthesis?.underwriting_questions?.length ?? 0;

  checks.push({
    gate_id: "synthesis",
    label: "Credit Synthesis Completion",
    status: synthesis && synthesis.executive_credit_thesis ? "pass" : "fail",
    reason: synthesis
      ? `Synthesis complete — ${contradictionsFound} contradictions, ${questionsFound} underwriting questions identified`
      : "Synthesis thread failed — no credit thesis produced",
    severity: !synthesis ? "error" : "info",
  });

  // ── Gate 6: Entity Validation Pass ───────────────────────────────────────
  const entityValidationPassed = bieResult.synthesis?.entity_validation_passed ?? false;

  checks.push({
    gate_id: "entity_validation_pass",
    label: "Synthesis Entity Validation",
    status: entityValidationPassed ? "pass" : "warn",
    reason: entityValidationPassed
      ? "Synthesis confirmed research is about the correct entity"
      : "Synthesis entity validation not passed — content may reference wrong entity",
    severity: entityValidationPassed ? "info" : "warn",
  });

  // ── Gate 7 (Phase 79): Contradiction Coverage ────────────────────────────
  // Required adversarial checks — each must be present in the synthesis
  // contradictions or addressed by the research threads.
  const contradictionCoverage = evaluateContradictionCoverage(bieResult);
  checks.push(contradictionCoverage.check);

  // ── Gate 8 (Phase 81): Section-Level Source Enforcement ──────────────────
  // sourcePolicy.ts defines per-section minimum source requirements.
  // Global source quality may pass while individual sections rely on
  // weak sources (e.g., 30 Yelp reviews). This gate enforces section-level.
  const sectionSourceCheck = evaluateSectionSourceCoverage(bieResult);
  checks.push(sectionSourceCheck.check);

  // ── Grade Assignment ──────────────────────────────────────────────────────
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const errorChecks = checks.filter((c) => c.severity === "error");

  let trustGrade: TrustGrade;
  if (errorChecks.length >= 2 || (errorChecks.length === 1 && errorChecks[0].gate_id === "entity_lock")) {
    trustGrade = "research_failed";
  } else if (errorChecks.length === 1 || failCount >= 2) {
    trustGrade = "manual_review_required";
  } else if (
    threadsSucceeded >= THRESHOLDS.committee_grade.min_threads_succeeded &&
    entityConfidence >= THRESHOLDS.committee_grade.min_entity_confidence &&
    allSourceUrls.length >= THRESHOLDS.committee_grade.min_source_count &&
    sourceQuality >= THRESHOLDS.committee_grade.min_source_quality_score &&
    (profiles.length === 0 || confirmedCount === profiles.length) &&
    !!synthesis &&
    entityValidationPassed &&
    !naicsIsPlaceholder &&  // Phase 80: NAICS 999999 can never reach committee_grade
    failCount === 0 &&
    warnCount <= 1
  ) {
    trustGrade = "committee_grade";
  } else if (threadsSucceeded >= THRESHOLDS.preliminary.min_threads_succeeded && !!synthesis) {
    trustGrade = "preliminary";
  } else {
    trustGrade = "manual_review_required";
  }

  // ── Quality Score (0–100) ─────────────────────────────────────────────────
  const qualityScore = computeQualityScore({
    entityConfidence,
    threadsSucceeded,
    sourceQuality,
    sourceCount: allSourceUrls.length,
    mgmtConfirmRate: profiles.length > 0 ? confirmedCount / profiles.length : 1.0,
    hasSynthesis: !!synthesis,
    contradictionsFound,
    entityValidationPassed,
    warnCount,
    failCount,
  });

  return {
    trust_grade: trustGrade,
    gate_passed: ["committee_grade", "preliminary"].includes(trustGrade),
    quality_score: qualityScore,
    checks,
    threads_succeeded: threadsSucceeded,
    threads_failed: threadsFailed,
    entity_confidence: entityConfidence,
    principals_confirmed: confirmedCount,
    principals_unconfirmed: unconfirmedCount,
    source_count: allSourceUrls.length,
    source_quality_score: sourceQuality,
    contradictions_found: contradictionsFound,
    underwriting_questions_found: questionsFound,
    evaluated_at: new Date().toISOString(),
  };
}

function getMissingThreads(result: BIEResult): string[] {
  const missing: string[] = [];
  if (!result.borrower) missing.push("borrower");
  if (!result.management) missing.push("management");
  if (!result.competitive) missing.push("competitive");
  if (!result.market) missing.push("market");
  if (!result.industry) missing.push("industry");
  if (!result.transaction) missing.push("transaction");
  return missing;
}

function computeQualityScore(params: {
  entityConfidence: number;
  threadsSucceeded: number;
  sourceQuality: number;
  sourceCount: number;
  mgmtConfirmRate: number;
  hasSynthesis: boolean;
  contradictionsFound: number;
  entityValidationPassed: boolean;
  warnCount: number;
  failCount: number;
}): number {
  let score = 0;
  score += params.entityConfidence * 20;          // max 20
  score += Math.min(params.threadsSucceeded / 6, 1) * 20;  // max 20
  score += params.sourceQuality * 15;              // max 15
  score += Math.min(params.sourceCount / 20, 1) * 10;  // max 10
  score += params.mgmtConfirmRate * 15;            // max 15
  score += params.hasSynthesis ? 10 : 0;           // 10
  score += Math.min(params.contradictionsFound, 3) * 2;  // max 6 (reward adversarial)
  score += params.entityValidationPassed ? 4 : 0;  // 4
  score -= params.warnCount * 2;
  score -= params.failCount * 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Phase 79: Contradiction Coverage Enforcement
// ---------------------------------------------------------------------------

/**
 * Required adversarial contradiction checks.
 * Each check must be addressed (clear, flagged, or insufficient_evidence)
 * in the synthesis contradictions for committee-grade research.
 */
export const REQUIRED_CONTRADICTION_CHECKS = [
  "identity_mismatch",
  "dba_mismatch",
  "geography_mismatch",
  "scale_plausibility",
  "management_history_conflict",
  "regulatory_vs_margin",
  "competitive_position_conflict",
  "repayment_story_conflict",
] as const;

export type ContradictionCheckKey = typeof REQUIRED_CONTRADICTION_CHECKS[number];

/**
 * Pattern-based detection of which required checks are covered in the
 * free-text contradictions from BIE synthesis.
 */
const CHECK_PATTERNS: Record<ContradictionCheckKey, RegExp[]> = {
  identity_mismatch: [
    /\bname.*mismatch\b/i, /\bentity.*mismatch\b/i, /\blegal\s+name\b/i,
    /\bidentity\b/i, /\bUNVALIDATED_MANAGEMENT_PROFILE\b/,
  ],
  dba_mismatch: [
    /\bdba\b/i, /\bdoing\s+business\s+as\b/i, /\btrade\s*name\b/i,
  ],
  geography_mismatch: [
    /\bgeograph/i, /\blocation\b/i, /\bmarket.*different\b/i,
    /\bcompetitor.*different\s+market\b/i,
  ],
  scale_plausibility: [
    /\bscale\b/i, /\brevenue.*plausib/i, /\bhead\s*count\b/i,
    /\bsize.*inconsist/i, /\brevenue\b.*\bmatch\b/i,
  ],
  management_history_conflict: [
    /\bmanagement\b/i, /\bprincipal\b/i, /\bbackground\b/i,
    /\bhistory.*conflict\b/i, /\bexperience\b/i,
  ],
  regulatory_vs_margin: [
    /\bregulat/i, /\bcompliance\b/i, /\bmargin\b/i,
    /\blicens/i, /\benforcement\b/i,
  ],
  competitive_position_conflict: [
    /\bcompetit/i, /\bmarket\s*share\b/i, /\bposition/i,
    /\badvantage\b/i,
  ],
  repayment_story_conflict: [
    /\brepayment\b/i, /\bcash\s*flow\b/i, /\bdebt\s*service\b/i,
    /\bDSCR\b/i, /\bability\s+to\s+repay\b/i,
  ],
};

function evaluateContradictionCoverage(
  bieResult: BIEResult,
): { check: GateCheckResult; coveredChecks: ContradictionCheckKey[]; missingChecks: ContradictionCheckKey[] } {
  const contradictions = bieResult.synthesis?.contradictions_and_uncertainties ?? [];
  const allText = contradictions.join(" ");

  const covered: ContradictionCheckKey[] = [];
  const missing: ContradictionCheckKey[] = [];

  for (const checkKey of REQUIRED_CONTRADICTION_CHECKS) {
    const patterns = CHECK_PATTERNS[checkKey];
    const isAddressed = patterns.some((p) => p.test(allText));
    if (isAddressed) {
      covered.push(checkKey);
    } else {
      missing.push(checkKey);
    }
  }

  const coverageRate = covered.length / REQUIRED_CONTRADICTION_CHECKS.length;

  const check: GateCheckResult = {
    gate_id: "contradiction_coverage",
    label: "Adversarial Contradiction Coverage",
    status: missing.length === 0 ? "pass" : missing.length <= 3 ? "warn" : "fail",
    reason: missing.length === 0
      ? `All ${REQUIRED_CONTRADICTION_CHECKS.length} required contradiction checks addressed`
      : `${covered.length}/${REQUIRED_CONTRADICTION_CHECKS.length} checks addressed — missing: ${missing.join(", ")}`,
    severity: missing.length > 3 ? "warn" : "info",
  };

  return { check, coveredChecks: covered, missingChecks: missing };
}

// ---------------------------------------------------------------------------
// Phase 81: Section-Level Source Enforcement
// ---------------------------------------------------------------------------

/** Map BIE thread names to sourcePolicy section names */
const THREAD_TO_SECTION: Record<string, string> = {
  management: "Management Intelligence",
  borrower: "Borrower Profile",
  competitive: "Competitive Landscape",
  market: "Market Intelligence",
  industry: "Industry Overview",
};

function evaluateSectionSourceCoverage(
  bieResult: BIEResult,
): { check: GateCheckResult; failedSections: string[] } {
  const allUrls = bieResult.sources_used ?? [];
  const classifiedSources = allUrls.map((url) => ({
    url,
    type: classifySourceUrl(url),
  }));

  const failedSections: string[] = [];

  for (const req of SECTION_SOURCE_REQUIREMENTS) {
    // Find sources that match required types for this section
    const qualifyingSources = classifiedSources.filter((s) =>
      req.required_source_types.includes(s.type),
    );

    if (qualifyingSources.length < req.minimum_sources) {
      failedSections.push(req.section);
    }
  }

  const check: GateCheckResult = {
    gate_id: "section_source_coverage",
    label: "Section-Level Source Requirements",
    status: failedSections.length === 0 ? "pass" : failedSections.length <= 2 ? "warn" : "fail",
    reason: failedSections.length === 0
      ? `All ${SECTION_SOURCE_REQUIREMENTS.length} section source requirements met`
      : `${SECTION_SOURCE_REQUIREMENTS.length - failedSections.length}/${SECTION_SOURCE_REQUIREMENTS.length} sections meet source requirements — deficient: ${failedSections.join(", ")}`,
    severity: failedSections.length > 2 ? "warn" : "info",
  };

  return { check, failedSections };
}
