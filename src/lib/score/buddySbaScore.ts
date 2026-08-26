import "server-only";

/**
 * Buddy SBA Score — main entry point.
 *
 * Pipeline:
 *   1. loadScoreInputs() (which internally calls buildSBARiskProfile())
 *   2. evaluateBuddySbaEligibility()  — hard gate
 *   3. five component scorers        — pure functions
 *   4. weighted composite            — 0-100
 *   5. deterministic narrative       — no LLM
 *   6. supersede+insert RPC          — transactional
 *
 * See spec: specs/brokerage/sprint-00-buddy-sba-score.md
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScoreInputs, type ScoreInputs } from "./inputs";
import { evaluateBuddySbaEligibility } from "./eligibility/evaluate";
import { scoreBorrowerStrength } from "./components/borrowerStrength";
import { scoreBusinessStrength } from "./components/businessStrength";
import { scoreDealStructure } from "./components/dealStructure";
import { scoreRepaymentCapacity } from "./components/repaymentCapacity";
import { scoreFranchiseQuality } from "./components/franchiseQuality";
import { buildScoreNarrative, buildNotEligibleNarrative } from "./narrative";
import type {
  BuddySBAScore,
  ComputationContext,
  EligibilityResult,
  RateCardTier,
  ScoreBand,
} from "./types";

export const SCORE_VERSION = "1.0.0";

export async function computeBuddySBAScore(params: {
  dealId: string;
  sb: SupabaseClient;
  context?: ComputationContext;
}): Promise<BuddySBAScore> {
  const { dealId, sb, context = "manual" } = params;

  const inputs = await loadScoreInputs({ dealId, sb });
  const eligibility = evaluateBuddySbaEligibility({
    naics: inputs.naics,
    industry: inputs.industry,
    businessEntityType: inputs.businessEntityType,
    annualRevenueUsd: inputs.annualRevenueUsd,
    employeeCount: inputs.employeeCount,
    totalAssetsUsd: inputs.totalAssetsUsd ?? null,
    tangibleNetWorthUsd: inputs.tangibleNetWorthUsd ?? null,
    avgNetIncomeTwoYearUsd: inputs.avgNetIncomeTwoYearUsd ?? null,
    useOfProceeds: inputs.useOfProceeds,
    sourcesAndUses: inputs.sourcesAndUses,
    isFranchise: inputs.isFranchise,
    franchiseSbaEligible: inputs.franchise?.sbaEligible ?? null,
    franchiseSbaCertificationStatus: inputs.franchise?.sbaCertificationStatus ?? null,
    hardBlockers: inputs.riskProfile.hardBlockers,
    federalDebtDelinquent: inputs.federalDebtDelinquent,
    taxDelinquent: inputs.taxDelinquent,
    samDebarred: inputs.samDebarred,
    felonyConviction: inputs.felonyConviction,
    incarceratedOrParole: inputs.incarceratedOrParole,
    priorGovLoanDefault: inputs.priorGovLoanDefault,
    hasAffiliates: inputs.hasAffiliates,
  });

  // Build the score (skips component math for ineligible deals).
  const score = assembleScore({ inputs, eligibility, context });

  await persistScore(sb, score);
  return score;
}

/**
 * Pure-compute variant — used by the synthetic smoke test.
 * Takes pre-loaded inputs + eligibility and returns the score object
 * without hitting Supabase at all.
 */
export function assembleScoreForTesting(args: {
  inputs: ScoreInputs;
  eligibility: EligibilityResult;
  context?: ComputationContext;
}): BuddySBAScore {
  return assembleScore({ ...args, context: args.context ?? "manual" });
}

function assembleScore(args: {
  inputs: ScoreInputs;
  eligibility: EligibilityResult;
  context: ComputationContext;
}): BuddySBAScore {
  const { inputs, eligibility, context } = args;

  if (!eligibility.passed) {
    const narrative = buildNotEligibleNarrative(eligibility.failures);
    return buildNotEligibleScore({
      inputs,
      eligibility,
      narrative: narrative.narrative,
      topWeaknesses: narrative.weaknesses,
      context,
    });
  }

  const borrower = scoreBorrowerStrength(inputs);
  const business = scoreBusinessStrength(inputs);
  const structure = scoreDealStructure(inputs);
  const repayment = scoreRepaymentCapacity(inputs);
  const franchise = inputs.isFranchise ? scoreFranchiseQuality(inputs) : null;

  const weights = inputs.isFranchise
    ? { borrower: 0.25, business: 0.2, structure: 0.15, repayment: 0.3, franchise: 0.1 }
    : { borrower: 0.28, business: 0.22, structure: 0.17, repayment: 0.33, franchise: 0 };

  const composite =
    (borrower.rawScore * weights.borrower +
      business.rawScore * weights.business +
      structure.rawScore * weights.structure +
      repayment.rawScore * weights.repayment +
      (franchise?.rawScore ?? 0) * weights.franchise) *
    20; // 0–5 scale → 0–100

  const roundedScore = Math.max(0, Math.min(100, Math.round(composite)));
  const band = bandFor(roundedScore);
  const rateCardTier = rateCardTierFor(band);

  const narrative = buildScoreNarrative({
    score: roundedScore,
    band,
    borrower,
    business,
    structure,
    repayment,
    franchise,
  });

  return {
    dealId: inputs.dealId,
    bankId: inputs.bankId,
    scoreVersion: SCORE_VERSION,
    scoreStatus: "draft",
    lockedAt: null,
    eligibilityPassed: true,
    eligibilityFailures: [],
    score: roundedScore,
    band,
    rateCardTier,
    borrowerStrength: borrower,
    businessStrength: business,
    dealStructure: structure,
    repaymentCapacity: repayment,
    franchiseQuality: franchise,
    narrative: narrative.narrative,
    topStrengths: narrative.strengths,
    topWeaknesses: narrative.weaknesses,
    inputSnapshot: {
      ...inputs.snapshot,
      missingInputs: inputs.missingInputs,
      // Unresolved eligibility items ride in the existing jsonb snapshot
      // rather than a new column. They are NOT failures: they are what the
      // borrower still needs to supply, and the portal renders them as
      // Outstanding Items. Without this they were computed and discarded,
      // so a borrower blocked on "provide employee count" would see a
      // stalled package with no stated reason.
      eligibilityUnresolved: eligibility.unresolved ?? [],
    },
    weightsSnapshot: weights,
    computationContext: context,
  };
}

function buildNotEligibleScore(args: {
  inputs: ScoreInputs;
  eligibility: EligibilityResult;
  narrative: string;
  topWeaknesses: string[];
  context: ComputationContext;
}): BuddySBAScore {
  const { inputs, eligibility, narrative, topWeaknesses, context } = args;
  const zeroComponent = {
    componentName: "",
    rawScore: 0,
    weight: 0,
    contribution: 0,
    subFactors: [],
    narrative: "Not computed — deal failed eligibility gate.",
    missingInputs: [],
    insufficientData: false,
  };

  return {
    dealId: inputs.dealId,
    bankId: inputs.bankId,
    scoreVersion: SCORE_VERSION,
    scoreStatus: "draft",
    lockedAt: null,
    eligibilityPassed: false,
    eligibilityFailures: eligibility.failures,
    score: 0,
    band: "not_eligible",
    rateCardTier: null,
    borrowerStrength: { ...zeroComponent, componentName: "borrower_strength" },
    businessStrength: { ...zeroComponent, componentName: "business_strength" },
    dealStructure: { ...zeroComponent, componentName: "deal_structure" },
    repaymentCapacity: { ...zeroComponent, componentName: "repayment_capacity" },
    franchiseQuality: null,
    narrative,
    topStrengths: [],
    topWeaknesses,
    inputSnapshot: {
      ...inputs.snapshot,
      missingInputs: inputs.missingInputs,
      eligibilityUnresolved: eligibility.unresolved ?? [],
    },
    weightsSnapshot: {},
    computationContext: context,
  };
}

/**
 * SPEC-SCORE-IDEMPOTENCY-1 — no-op when nothing changed.
 *
 * `supersede_and_insert_buddy_sba_score` appends a row on every call, and
 * nothing upstream deduplicates. In production that produced 12,605 rows for
 * 38 deals (9,038 on a single deal in ten days, roughly one every 96 seconds)
 * and 46 MB of table — every one of them identical to its predecessor.
 *
 * A score is a pure function of its inputs, so recomputing with unchanged
 * inputs must not write history. We compare the freshly computed score and its
 * input snapshot against the current active row; if they match, we reuse that
 * row instead of superseding it.
 *
 * Deliberately compares `input_snapshot` and not just `score`: two different
 * input sets can round to the same composite, and history should record that
 * the inputs changed. A `locked` row is never reused — locking is a state
 * transition the caller is entitled to move off.
 */
async function findUnchangedActiveScore(
  sb: SupabaseClient,
  score: BuddySBAScore,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data: active, error } = await sb
    .from("buddy_sba_scores")
    .select("id, score, score_status, score_version, input_snapshot, eligibility_passed")
    .eq("deal_id", score.dealId)
    .is("superseded_at", null)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // On a read error, fall through to the insert — never drop a score because
  // the dedup lookup failed.
  if (error || !active) return null;

  const row = active as Record<string, any>;
  if (row.score_status === "locked") return null;
  if (row.score_version !== payload.score_version) return null;
  if (row.score !== payload.score) return null;
  if (row.eligibility_passed !== payload.eligibility_passed) return null;

  return canonicalJson(row.input_snapshot) === canonicalJson(payload.input_snapshot)
    ? String(row.id)
    : null;
}

/**
 * Order-independent JSON serialization for comparing a jsonb round-trip
 * against a freshly built object.
 *
 * Postgres `jsonb` does not preserve key insertion order — it normalizes keys
 * (by length, then bytewise) — so the object that comes back from
 * input_snapshot can have a different key order than the identical object we
 * just computed. A plain JSON.stringify comparison would therefore report
 * "changed" on almost every call and silently defeat the dedupe. Sort keys
 * recursively so the comparison is on content.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value ?? null));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

async function persistScore(sb: SupabaseClient, score: BuddySBAScore): Promise<void> {
  const payload = {
    score_version: score.scoreVersion,
    score_status: score.scoreStatus,
    eligibility_passed: score.eligibilityPassed,
    eligibility_failures: score.eligibilityFailures,
    score: score.score,
    band: score.band,
    rate_card_tier: score.rateCardTier,
    borrower_strength: score.borrowerStrength,
    business_strength: score.businessStrength,
    deal_structure: score.dealStructure,
    repayment_capacity: score.repaymentCapacity,
    franchise_quality: score.franchiseQuality,
    narrative: score.narrative,
    top_strengths: score.topStrengths,
    top_weaknesses: score.topWeaknesses,
    input_snapshot: score.inputSnapshot,
    weights_snapshot: score.weightsSnapshot,
    computation_context: score.computationContext,
  };

  const unchangedId = await findUnchangedActiveScore(sb, score, payload);
  if (unchangedId) {
    score.id = unchangedId;
    return;
  }

  const { data, error } = await sb.rpc("supersede_and_insert_buddy_sba_score", {
    p_deal_id: score.dealId,
    p_bank_id: score.bankId,
    p_payload: payload,
  });
  if (error) {
    throw new Error(`Failed to persist Buddy SBA Score: ${error.message}`);
  }
  score.id = data as string;
}

export async function lockBuddySBAScore(args: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<{ ok: boolean; lockedId?: string; error?: string }> {
  const { data, error } = await args.sb.rpc("lock_buddy_sba_score", {
    p_deal_id: args.dealId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, lockedId: data as string };
}

function bandFor(score: number): ScoreBand {
  if (score >= 90) return "institutional_prime";
  if (score >= 80) return "strong_fit";
  if (score >= 70) return "selective_fit";
  if (score >= 60) return "specialty_lender";
  return "not_eligible";
}

function rateCardTierFor(band: ScoreBand): RateCardTier | null {
  switch (band) {
    case "institutional_prime":
      return "best";
    case "strong_fit":
      return "standard";
    case "selective_fit":
      return "widened";
    case "specialty_lender":
      return "widest";
    default:
      return null;
  }
}
