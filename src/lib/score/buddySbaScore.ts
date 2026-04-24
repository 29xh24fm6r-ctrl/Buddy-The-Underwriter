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
    useOfProceeds: inputs.useOfProceeds,
    sourcesAndUses: inputs.sourcesAndUses,
    isFranchise: inputs.isFranchise,
    franchiseSbaEligible: inputs.franchise?.sbaEligible ?? null,
    franchiseSbaCertificationStatus: inputs.franchise?.sbaCertificationStatus ?? null,
    hardBlockers: inputs.riskProfile.hardBlockers,
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
    inputSnapshot: { ...inputs.snapshot, missingInputs: inputs.missingInputs },
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
    inputSnapshot: { ...inputs.snapshot, missingInputs: inputs.missingInputs },
    weightsSnapshot: {},
    computationContext: context,
  };
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
