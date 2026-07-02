/**
 * SPEC-GUIDED-STAGE-RAIL-1 — pure step-projection tests.
 *
 * stepsForStage projects a stage's gated blockers into a clickable step checklist,
 * ordered by underwriting workstream; stageClearForAdvance decides when auto-advance
 * is safe. Placed under src/lib so the `test:unit` gate runs it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stepsForStage, stageClearForAdvance } from "../stageSteps";
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

describe("stepsForStage", () => {
  it("returns only blockers gated to the given stage", () => {
    const s = state("underwrite_ready", [
      b("spreads_incomplete"),           // → underwrite_ready
      b("financial_snapshot_missing"),   // → underwrite_ready
      b("decision_missing"),             // → committee_decisioned (excluded)
      b("data_fetch_failed"),            // → null / infra (excluded)
    ]);
    const steps = stepsForStage(s, "underwrite_ready", DEAL);
    const codes = steps.map((x) => x.code).sort();
    assert.deepEqual(codes, ["financial_snapshot_missing", "spreads_incomplete"]);
  });

  it("orders underwriting blockers per UNDERWRITING_WORKSTREAM_ORDER", () => {
    // Provided spread-first, but financial_computation (index 2) precedes spread_evidence (index 3).
    const s = state("underwrite_ready", [
      b("spreads_incomplete"),
      b("financial_snapshot_missing"),
    ]);
    const steps = stepsForStage(s, "underwrite_ready", DEAL);
    assert.deepEqual(
      steps.map((x) => x.code),
      ["financial_snapshot_missing", "spreads_incomplete"],
    );
  });

  it("gives action-only / unmapped-fix blockers href: null; href-backed fixes keep their href", () => {
    const s = state("underwrite_ready", [
      b("financial_snapshot_missing"), // fix is { action } only → null
      b("spreads_incomplete"),         // fix has href → non-null
    ]);
    const steps = stepsForStage(s, "underwrite_ready", DEAL);
    const byCode = new Map(steps.map((x) => [x.code, x]));
    assert.equal(byCode.get("financial_snapshot_missing")!.href, null);
    assert.equal(byCode.get("spreads_incomplete")!.href, `/deals/${DEAL}/spreads`);
    // label falls back to the fix label, not the raw message
    assert.equal(byCode.get("financial_snapshot_missing")!.label, "Generate Snapshot");
  });

  it("returns an empty list when the stage has no gated blockers", () => {
    const s = state("underwrite_ready", [b("decision_missing")]);
    assert.deepEqual(stepsForStage(s, "underwrite_ready", DEAL), []);
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
