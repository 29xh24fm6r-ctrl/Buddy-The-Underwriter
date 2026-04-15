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
import { computeSourceQualityScore, classifySourceUrl } from "./sourcePolicy";

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
): CompletionGateResult {
  const checks: GateCheckResult[] = [];

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
