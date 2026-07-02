/**
 * SPEC-GUIDED-STAGE-RAIL-1 / -1B — pure step-projection tests.
 *
 * stepsForCurrentStage projects EVERY open non-infra blocker into the current stage's
 * checklist, ordered by underwriting workstream; its first item agrees with
 * buildJourneyPrimaryAction's top pick. stageClearForAdvance decides when auto-advance
 * is safe. Placed under src/lib so the `test:unit` gate runs it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stepsForCurrentStage, stageClearForAdvance } from "../stageSteps";
import { buildJourneyPrimaryAction } from "@/lib/journey/journeyActionProjection";
import type { LifecycleBlocker, LifecycleState, LifecycleStage } from "@/buddy/lifecycle/model";

const DEAL = "deal-omni";

const derived: LifecycleState["derived"] = {
  readinessMode: "disabled",
  documentsReady: true,
  documentsReadinessPct: 100,
  underwriteStarted: true,
  financialSnapshotExists: true,
  committeePacketReady: false,
  decisionPresent: false,
  committeeRequired: false,
  pricingQuoteReady: false,
  riskPricingFinalized: false,
  attestationSatisfied: true,
  aiPipelineComplete: true,
  spreadsComplete: true,
  structuralPricingReady: true,
  hasPricingAssumptions: true,
  hasSubmittedLoanRequest: true,
  hasLoanRequestWithAmount: true,
  researchComplete: true,
  criticalFlagsResolved: true,
};

const b = (code: LifecycleBlocker["code"], message: string = code): LifecycleBlocker => ({ code, message });

const state = (stage: LifecycleStage, blockers: LifecycleBlocker[]): LifecycleState => ({
  stage,
  lastAdvancedAt: null,
  blockers,
  derived,
});

describe("stepsForCurrentStage", () => {
  it("lists every open non-infra blocker, workstream-ordered; infra excluded", () => {
    // eefd62b3-shaped: open work gates other stages, plus one infra blocker.
    const s = state("underwrite_in_progress", [
      b("missing_global_cash_flow"),   // financial_computation (idx 2), gates underwrite_ready
      b("risk_pricing_not_finalized"), // risk_pricing (idx 6), gates closing_in_progress
      b("missing_management_profile"), // memo_inputs (idx 4), gates memo_inputs_required
      b("snapshot_fetch_failed"),      // infra → blockerGatesStage null → excluded
    ]);
    const steps = stepsForCurrentStage(s, DEAL);
    assert.deepEqual(
      steps.map((x) => x.code),
      ["missing_global_cash_flow", "missing_management_profile", "risk_pricing_not_finalized"],
      "all 3 non-infra blockers, ordered financial_computation → memo_inputs → risk_pricing",
    );
    assert.ok(
      !steps.some((x) => x.code === "snapshot_fetch_failed"),
      "infrastructure blockers must never appear as steps",
    );
  });

  it("first step agrees with buildJourneyPrimaryAction (label + href)", () => {
    const s = state("underwrite_in_progress", [
      b("missing_global_cash_flow"),
      b("risk_pricing_not_finalized"),
      b("missing_management_profile"),
    ]);
    const steps = stepsForCurrentStage(s, DEAL);
    const primary = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(steps[0].label, primary.label);
    assert.equal(steps[0].href, primary.href);
  });

  it("action-only fixes get href null; href-backed fixes keep their href", () => {
    const s = state("underwrite_ready", [
      b("financial_snapshot_missing"), // { action } only → null
      b("spreads_incomplete"),         // href → /deals/<id>/spreads
    ]);
    const byCode = new Map(stepsForCurrentStage(s, DEAL).map((x) => [x.code, x]));
    assert.equal(byCode.get("financial_snapshot_missing")!.href, null);
    assert.equal(byCode.get("financial_snapshot_missing")!.label, "Generate Snapshot");
    assert.equal(byCode.get("spreads_incomplete")!.href, `/deals/${DEAL}/spreads`);
  });

  it("returns an empty list when only infra blockers remain", () => {
    const s = state("underwrite_ready", [b("snapshot_fetch_failed"), b("data_fetch_failed")]);
    assert.deepEqual(stepsForCurrentStage(s, DEAL), []);
  });
});

describe("stageClearForAdvance", () => {
  it("is false for closed and workout regardless of blockers", () => {
    assert.equal(stageClearForAdvance(state("closed", [])), false);
    assert.equal(stageClearForAdvance(state("workout", [])), false);
  });

  it("is false when any blockers remain", () => {
    assert.equal(stageClearForAdvance(state("underwrite_ready", [b("spreads_incomplete")])), false);
  });

  it("is true for a non-terminal stage with zero blockers", () => {
    assert.equal(stageClearForAdvance(state("underwrite_ready", [])), true);
    assert.equal(stageClearForAdvance(state("docs_in_progress", [])), true);
  });
});
