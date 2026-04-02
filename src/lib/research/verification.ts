/**
 * Verification Layer — Phase 66A (Commit 9)
 *
 * Source hygiene, corroboration, freshness, contradiction preservation,
 * and usability gate for research outputs.
 *
 * Extends existing: src/lib/research/integrity.ts (mission integrity checks)
 *
 * Does NOT improve outputs — only captures verification state.
 * Improvement is a future concern.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchFact, ResearchSource, ResearchInference } from "./types";
import { recordFailure } from "./failureLibrary";

// ============================================================================
// Types
// ============================================================================

export type VerificationCheck =
  | "source_hygiene"
  | "corroboration"
  | "freshness"
  | "contradiction"
  | "usability";

export type VerificationSeverity = "pass" | "warning" | "fail";

export type VerificationResult = {
  check: VerificationCheck;
  severity: VerificationSeverity;
  message: string;
  details?: Record<string, unknown>;
};

export type VerificationReport = {
  missionId: string;
  checks: VerificationResult[];
  overallPass: boolean;
  score: number; // 0-100
  generatedAt: string;
};

// ============================================================================
// Source Hygiene
// ============================================================================

/**
 * Check source hygiene: checksums present, HTTP success, no fetch errors.
 */
export function checkSourceHygiene(sources: ResearchSource[]): VerificationResult[] {
  const results: VerificationResult[] = [];

  const missingChecksums = sources.filter((s) => !s.checksum);
  if (missingChecksums.length > 0) {
    results.push({
      check: "source_hygiene",
      severity: "fail",
      message: `${missingChecksums.length} source(s) missing checksum`,
      details: { source_ids: missingChecksums.map((s) => s.id) },
    });
  }

  const failedFetches = sources.filter((s) => s.fetch_error);
  if (failedFetches.length > 0) {
    results.push({
      check: "source_hygiene",
      severity: "warning",
      message: `${failedFetches.length} source(s) had fetch errors`,
      details: { errors: failedFetches.map((s) => ({ id: s.id, error: s.fetch_error })) },
    });
  }

  const nonSuccess = sources.filter((s) => s.http_status && (s.http_status < 200 || s.http_status >= 300));
  if (nonSuccess.length > 0) {
    results.push({
      check: "source_hygiene",
      severity: "warning",
      message: `${nonSuccess.length} source(s) returned non-2xx HTTP status`,
    });
  }

  if (results.length === 0) {
    results.push({ check: "source_hygiene", severity: "pass", message: "All sources pass hygiene checks" });
  }

  return results;
}

// ============================================================================
// Corroboration
// ============================================================================

/**
 * Check if facts are corroborated by multiple sources.
 * Facts from a single source get a warning.
 */
export function checkCorroboration(facts: ResearchFact[], sources: ResearchSource[]): VerificationResult[] {
  const results: VerificationResult[] = [];
  const sourceClassByFact = new Map<string, Set<string>>();

  for (const fact of facts) {
    const source = sources.find((s) => s.id === fact.source_id);
    if (!source) continue;

    const key = `${fact.fact_type}:${JSON.stringify(fact.value)}`;
    if (!sourceClassByFact.has(key)) sourceClassByFact.set(key, new Set());
    sourceClassByFact.get(key)!.add(source.source_class);
  }

  const singleSourceFacts = Array.from(sourceClassByFact.entries())
    .filter(([, classes]) => classes.size === 1);

  if (singleSourceFacts.length > facts.length * 0.5) {
    results.push({
      check: "corroboration",
      severity: "warning",
      message: `${singleSourceFacts.length}/${facts.length} facts rely on a single source class`,
    });
  } else {
    results.push({ check: "corroboration", severity: "pass", message: "Adequate source diversity" });
  }

  return results;
}

// ============================================================================
// Freshness
// ============================================================================

/**
 * Check data freshness — flag stale sources (> 1 year old).
 */
export function checkFreshness(sources: ResearchSource[]): VerificationResult[] {
  const results: VerificationResult[] = [];
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const staleSources = sources.filter((s) => new Date(s.retrieved_at) < oneYearAgo);

  if (staleSources.length > 0) {
    results.push({
      check: "freshness",
      severity: "warning",
      message: `${staleSources.length} source(s) are over 1 year old`,
      details: { source_ids: staleSources.map((s) => s.id) },
    });
  } else {
    results.push({ check: "freshness", severity: "pass", message: "All sources are recent" });
  }

  return results;
}

// ============================================================================
// Contradiction Detection
// ============================================================================

/**
 * Detect contradictions between inferences.
 * Contradictions are PRESERVED (not resolved) — this is a detection layer.
 */
export function checkContradictions(inferences: ResearchInference[]): VerificationResult[] {
  const results: VerificationResult[] = [];

  // Look for opposing conclusions on the same inference type
  const byType = new Map<string, ResearchInference[]>();
  for (const inf of inferences) {
    if (!byType.has(inf.inference_type)) byType.set(inf.inference_type, []);
    byType.get(inf.inference_type)!.push(inf);
  }

  for (const [type, group] of byType) {
    if (group.length < 2) continue;

    // Check for contradictory confidence directions
    const highConf = group.filter((i) => i.confidence >= 0.7);
    const lowConf = group.filter((i) => i.confidence < 0.3);

    if (highConf.length > 0 && lowConf.length > 0) {
      results.push({
        check: "contradiction",
        severity: "warning",
        message: `Contradictory confidence levels for ${type} (${highConf.length} high vs ${lowConf.length} low)`,
        details: { inference_type: type },
      });
    }
  }

  if (results.length === 0) {
    results.push({ check: "contradiction", severity: "pass", message: "No contradictions detected" });
  }

  return results;
}

// ============================================================================
// Usability Gate
// ============================================================================

/**
 * Check if the research output is usable (minimum quality bar).
 */
export function checkUsability(
  sources: ResearchSource[],
  facts: ResearchFact[],
  inferences: ResearchInference[],
): VerificationResult[] {
  const results: VerificationResult[] = [];

  if (sources.length === 0) {
    results.push({ check: "usability", severity: "fail", message: "No sources — research unusable" });
    return results;
  }

  if (facts.length === 0) {
    results.push({ check: "usability", severity: "fail", message: "No facts extracted — research unusable" });
    return results;
  }

  if (inferences.length === 0) {
    results.push({ check: "usability", severity: "warning", message: "No inferences derived — limited value" });
  }

  // Check minimum fact quality
  const avgConfidence = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;
  if (avgConfidence < 0.5) {
    results.push({
      check: "usability",
      severity: "warning",
      message: `Low average fact confidence (${(avgConfidence * 100).toFixed(0)}%)`,
    });
  }

  if (results.length === 0) {
    results.push({ check: "usability", severity: "pass", message: "Research output meets usability bar" });
  }

  return results;
}

// ============================================================================
// Full Verification
// ============================================================================

/**
 * Run all verification checks and produce a report.
 */
export function runVerification(
  missionId: string,
  sources: ResearchSource[],
  facts: ResearchFact[],
  inferences: ResearchInference[],
): VerificationReport {
  const checks = [
    ...checkSourceHygiene(sources),
    ...checkCorroboration(facts, sources),
    ...checkFreshness(sources),
    ...checkContradictions(inferences),
    ...checkUsability(sources, facts, inferences),
  ];

  const failCount = checks.filter((c) => c.severity === "fail").length;
  const warnCount = checks.filter((c) => c.severity === "warning").length;
  const passCount = checks.filter((c) => c.severity === "pass").length;

  const score = Math.max(0, Math.round(
    ((passCount * 100 + warnCount * 50) / Math.max(checks.length, 1)),
  ));

  return {
    missionId,
    checks,
    overallPass: failCount === 0,
    score,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Persist verification evidence to buddy_research_evidence.
 */
export async function persistVerificationEvidence(
  sb: SupabaseClient,
  missionId: string,
  report: VerificationReport,
): Promise<void> {
  const rows = report.checks
    .filter((c) => c.severity !== "pass")
    .map((c) => ({
      mission_id: missionId,
      evidence_type: "fact" as const,
      claim: c.message,
      supporting_data: { check: c.check, severity: c.severity, details: c.details },
      confidence: c.severity === "fail" ? 1.0 : 0.6,
    }));

  if (rows.length === 0) return;

  const { error } = await sb.from("buddy_research_evidence").insert(rows);

  if (error) {
    console.error("[verification] persist evidence failed", { missionId, error });
  }
}
