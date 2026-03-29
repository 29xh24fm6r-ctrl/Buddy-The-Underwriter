import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { computeDecisionEnvelope, KERNEL_VERSION } from "../computeDecisionEnvelope";
import { buildCandidates } from "../buildCandidates";
import { scoreCandidates } from "../scoreCandidates";
import { detectDecisionConflicts } from "../detectDecisionConflicts";
import { compareDecisionEnvelopes } from "../compareDecisionEnvelopes";
import { toOmegaPrimeContext } from "../toOmegaPrimeContext";
import type { DecisionKernelInput, EvidenceEnvelope } from "../types";

function baseInput(overrides: Partial<DecisionKernelInput> = {}): DecisionKernelInput {
  return {
    relationshipId: "rel-1",
    asOf: "2026-03-29T12:00:00Z",
    hasIntegrityIssue: false,
    integrityIssueIds: [],
    activeWatchlistCaseId: null,
    watchlistSeverity: null,
    activeWorkoutCaseId: null,
    workoutSeverity: null,
    workoutStage: null,
    overdueWorkoutActionIds: [],
    workoutStaleDays: null,
    hasCryptoLiquidationReview: false,
    cryptoLiquidationEventId: null,
    hasCryptoCurePending: false,
    cryptoCureEventId: null,
    hasCryptoWarning: false,
    hasAnnualReviewOverdue: false,
    annualReviewId: null,
    hasRenewalOverdue: false,
    renewalId: null,
    renewalDueAt: null,
    hasBankerDeadline: false,
    bankerDeadlineAt: null,
    hasBorrowerOverdue: false,
    borrowerRequestIds: [],
    hasProtectionWork: false,
    protectionCaseId: null,
    protectionSeverity: null,
    hasGrowthWork: false,
    growthCaseId: null,
    relationshipExposureUsd: null,
    operatingState: "performing",
    evidence: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceEnvelope> = {}): EvidenceEnvelope {
  return {
    evidenceId: "ev-1",
    sourceType: "watchlist_case",
    sourceId: "src-1",
    assertedFact: "test",
    assertedValue: true,
    observedAt: "2026-03-29T12:00:00Z",
    freshnessClass: "live",
    derivation: "direct",
    confidence: "certain",
    lineage: [],
    policyRelevant: true,
    ...overrides,
  };
}

// ─── Invariant tests ──────────────────────────────────────────────────────────

describe("computeDecisionEnvelope — invariants", () => {
  it("1. exactly one primary action always returned", () => {
    const result = computeDecisionEnvelope(baseInput());
    assert.ok(result.primaryAction);
    assert.ok(typeof result.primaryAction.code === "string");
  });

  it("2. integrity outranks everything", () => {
    const result = computeDecisionEnvelope(baseInput({
      hasIntegrityIssue: true,
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "critical",
      hasCryptoLiquidationReview: true,
    }));
    assert.equal(result.systemTier, "integrity");
    assert.equal(result.primaryAction?.code, "repair_integrity");
  });

  it("3. critical distress outranks time-bound work", () => {
    const result = computeDecisionEnvelope(baseInput({
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "critical",
      overdueWorkoutActionIds: ["ai-1"],
      hasRenewalOverdue: true,
      renewalId: "ren-1",
      evidence: [makeEvidence({ sourceType: "workout_case" })],
    }));
    assert.equal(result.systemTier, "critical_distress");
  });

  it("4. crypto liquidation outranks growth", () => {
    const result = computeDecisionEnvelope(baseInput({
      hasCryptoLiquidationReview: true,
      cryptoLiquidationEventId: "evt-1",
      hasGrowthWork: true,
      growthCaseId: "g-1",
      evidence: [makeEvidence({ sourceType: "crypto_valuation" })],
    }));
    assert.equal(result.primaryAction?.code, "approve_crypto_liquidation");
  });

  it("5. protection outranks growth", () => {
    const result = computeDecisionEnvelope(baseInput({
      hasProtectionWork: true,
      protectionCaseId: "pc-1",
      protectionSeverity: "high",
      hasGrowthWork: true,
      growthCaseId: "g-1",
    }));
    assert.notEqual(result.primaryAction?.code, "advance_growth_case");
  });

  it("6. no growth outranks active workout", () => {
    const result = computeDecisionEnvelope(baseInput({
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "high",
      hasGrowthWork: true,
      growthCaseId: "g-1",
      evidence: [makeEvidence({ sourceType: "workout_case" })],
    }));
    assert.notEqual(result.primaryAction?.code, "advance_growth_case");
    assert.equal(result.systemTier, "critical_distress");
  });

  it("7. healthy relationship returns monitor_only", () => {
    const result = computeDecisionEnvelope(baseInput());
    assert.equal(result.primaryAction?.code, "monitor_only");
    assert.equal(result.systemTier, "informational");
  });

  it("8. deterministic — 100 iterations", () => {
    const input = baseInput({
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "critical",
      overdueWorkoutActionIds: ["ai-1"],
      hasRenewalOverdue: true,
      renewalId: "ren-1",
      hasCryptoWarning: true,
      evidence: [makeEvidence({ sourceType: "workout_case" })],
    });
    const first = computeDecisionEnvelope(input);
    for (let i = 0; i < 100; i++) {
      const result = computeDecisionEnvelope(input);
      assert.equal(result.primaryAction?.code, first.primaryAction?.code);
      assert.equal(result.systemTier, first.systemTier);
    }
  });

  it("9. every decision carries kernel version", () => {
    const result = computeDecisionEnvelope(baseInput());
    assert.equal(result.diagnostics.kernelVersion, KERNEL_VERSION);
  });

  it("10. stale inputs flagged in freshness", () => {
    const result = computeDecisionEnvelope(baseInput({
      evidence: [makeEvidence({ freshnessClass: "stale", sourceId: "stale-1" })],
    }));
    assert.equal(result.freshness.recomputeRequired, true);
    assert.ok(result.freshness.staleInputs.includes("stale-1"));
  });
});

// ─── Conflict detection ───────────────────────────────────────────────────────

describe("detectDecisionConflicts", () => {
  it("detects workout + performing conflict", () => {
    const conflicts = detectDecisionConflicts(baseInput({
      activeWorkoutCaseId: "wo-1",
      operatingState: "performing",
    }));
    assert.ok(conflicts.some((c) => c.conflictType === "active_workout_and_performing"));
  });

  it("detects dual active cases", () => {
    const conflicts = detectDecisionConflicts(baseInput({
      activeWatchlistCaseId: "wl-1",
      activeWorkoutCaseId: "wo-1",
    }));
    assert.ok(conflicts.some((c) => c.conflictType === "conflicting_cases"));
  });

  it("detects missing evidence for distress", () => {
    const conflicts = detectDecisionConflicts(baseInput({
      activeWatchlistCaseId: "wl-1",
      evidence: [],
    }));
    assert.ok(conflicts.some((c) => c.conflictType === "missing_evidence_for_distress"));
  });

  it("detects growth over protection conflict", () => {
    const conflicts = detectDecisionConflicts(baseInput({
      hasGrowthWork: true,
      growthCaseId: "g-1",
      activeWorkoutCaseId: "wo-1",
    }));
    assert.ok(conflicts.some((c) => c.conflictType === "growth_over_protection"));
  });
});

// ─── Compare envelopes ────────────────────────────────────────────────────────

describe("compareDecisionEnvelopes", () => {
  it("detects initial decision", () => {
    const next = computeDecisionEnvelope(baseInput());
    const result = compareDecisionEnvelopes(null, next);
    assert.equal(result.changed, true);
    assert.ok(result.changes.includes("initial_decision"));
  });

  it("detects tier change", () => {
    const prev = computeDecisionEnvelope(baseInput());
    const next = computeDecisionEnvelope(baseInput({
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "critical",
      evidence: [makeEvidence({ sourceType: "workout_case" })],
    }));
    const result = compareDecisionEnvelopes(prev, next);
    assert.equal(result.changed, true);
    assert.ok(result.changes.some((c) => c.startsWith("tier_changed")));
  });

  it("no change for identical input", () => {
    const a = computeDecisionEnvelope(baseInput());
    const b = computeDecisionEnvelope(baseInput());
    const result = compareDecisionEnvelopes(a, b);
    assert.equal(result.changed, false);
  });
});

// ─── Omega adapter ────────────────────────────────────────────────────────────

describe("toOmegaPrimeContext", () => {
  it("converts envelope to Omega context", () => {
    const envelope = computeDecisionEnvelope(baseInput({
      activeWorkoutCaseId: "wo-1",
      workoutSeverity: "high",
      evidence: [makeEvidence({ sourceType: "workout_case", policyRelevant: true })],
    }));
    const ctx = toOmegaPrimeContext(envelope);
    assert.equal(ctx.relationshipId, "rel-1");
    assert.ok(ctx.canonicalPrimaryAction);
    assert.equal(ctx.kernelVersion, KERNEL_VERSION);
    assert.equal(ctx.evidenceSummary.totalCount, 1);
    assert.equal(ctx.evidenceSummary.policyRelevantCount, 1);
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Decision kernel pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");
  const PURE_FILES = [
    "types.ts",
    "buildCandidates.ts",
    "scoreCandidates.ts",
    "computeDecisionEnvelope.ts",
    "detectDecisionConflicts.ts",
    "compareDecisionEnvelopes.ts",
    "toOmegaPrimeContext.ts",
  ];

  it("no DB imports", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no server-only", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes('"server-only"'), `${f} must not import server-only`);
    }
  });

  it("no Math.random", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });

  it("no Date.now", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Date.now"), `${f} must not use Date.now`);
    }
  });

  it("types file has zero runtime imports", () => {
    const content = fs.readFileSync(path.join(DIR, "types.ts"), "utf-8");
    const runtimeImports = content.split("\n").filter(
      (l) => l.startsWith("import ") && !l.includes("type"),
    );
    assert.equal(runtimeImports.length, 0);
  });
});
