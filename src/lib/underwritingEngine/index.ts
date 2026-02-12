/**
 * Underwriting Engine — Public API
 *
 * Full-pipeline orchestrator: snapshot → lens → policy → stress → pricing → memo.
 * No new logic — pure composition of all prior phases.
 *
 * ORCHESTRATOR: Chains Phase 4A → 4B → 5 → 5B → 5C → 6.
 */

import type { CreditSnapshotOpts } from "@/lib/creditMetrics/types";
import { computeCreditSnapshot } from "@/lib/creditMetrics";
import { computeProductAnalysis } from "@/lib/creditLenses";
import { evaluatePolicy } from "@/lib/policyEngine";
import { runStressScenarios } from "@/lib/stressEngine";
import { computePricing } from "@/lib/pricingEngine";
import { generateMemo } from "@/lib/memoEngine";
import type { UnderwriteInput, UnderwriteResult, UnderwriteFailure } from "./types";

// Re-export types
export type { UnderwriteInput, UnderwriteResult, UnderwriteFailure } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full institutional underwriting pipeline.
 *
 * Pipeline:
 * 1. computeCreditSnapshot → CreditSnapshot
 * 2. computeProductAnalysis → ProductAnalysis
 * 3. evaluatePolicy → PolicyResult
 * 4. runStressScenarios → StressResult
 * 5. computePricing → PricingResult
 * 6. generateMemo → CreditMemo
 *
 * Returns UnderwriteResult on success, UnderwriteFailure if snapshot or stress fails.
 *
 * Pure function — deterministic, no side effects.
 */
export function runFullUnderwrite(
  input: UnderwriteInput,
): UnderwriteResult | UnderwriteFailure {
  const { model, product, instruments } = input;

  // Build snapshot opts with defaults
  const snapshotOpts: CreditSnapshotOpts = {
    strategy: "LATEST_AVAILABLE",
    ...input.snapshotOpts,
    instruments,
  };

  // Step 1: Credit snapshot
  const snapshot = computeCreditSnapshot(model, snapshotOpts);
  if (!snapshot) {
    return {
      failedAt: "snapshot",
      diagnostics: {
        pipelineComplete: false,
        reason: "No suitable analysis period found in financial model.",
      },
    };
  }

  // Step 2: Product lens analysis
  const analysis = computeProductAnalysis(snapshot, product);

  // Step 3: Policy evaluation
  const policy = evaluatePolicy(snapshot, product);

  // Step 4: Stress testing
  const stress = runStressScenarios(model, instruments, snapshotOpts, { product });
  if (!stress) {
    return {
      failedAt: "stress",
      diagnostics: {
        pipelineComplete: false,
        reason: "Stress engine failed — baseline scenario could not produce a snapshot.",
      },
    };
  }

  // Step 5: Pricing
  const pricing = computePricing({
    product,
    tier: policy.tier,
    stressedTier: stress.worstTier,
  });

  // Step 6: Memo generation
  const memo = generateMemo({
    dealId: model.dealId,
    product,
    snapshot,
    analysis,
    policy,
    stress,
    pricing,
  });

  return {
    snapshot,
    analysis,
    policy,
    stress,
    pricing,
    memo,
    diagnostics: { pipelineComplete: true },
  };
}
