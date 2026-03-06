/**
 * Proof-of-Correctness Engine — Tests
 *
 * Tests the corroboration, reasonableness, and confidence aggregation gates.
 * All tested functions are pure — no DB stubs needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Proof-of-Correctness Engine", async () => {
  const { corroborateDocumentFacts } = await import("../corroborationEngine");
  const { checkReasonableness } = await import("../reasonablenessEngine");
  const { aggregateDocumentConfidence } = await import("../confidenceAggregator");

  // ── Test 1: All gates pass → AUTO_VERIFIED ────────────────────────

  it("all gates pass → status = AUTO_VERIFIED", () => {
    // Identity: all passed
    const identityCheckResult = { passedCount: 3, failedCount: 0, skippedCount: 0 };

    // Corroboration: all passed
    const corroborationResult = { passedCount: 2, failedCount: 0, skippedCount: 1 };

    // Reasonableness: no failures
    const reasonablenessResult = { impossibleFailures: 0, anomalousWarnings: 0 };

    // Field confidence: all high
    const fieldConfidenceScores: Record<string, number> = {
      GROSS_RECEIPTS: 0.98,
      COST_OF_GOODS_SOLD: 0.95,
      GROSS_PROFIT: 0.97,
      ORDINARY_BUSINESS_INCOME: 0.96,
    };

    const result = aggregateDocumentConfidence({
      fieldConfidenceScores,
      identityCheckResult,
      corroborationResult,
      reasonablenessResult,
    });

    assert.equal(result.status, "AUTO_VERIFIED");
    assert.ok(result.score >= 0.92, `score ${result.score} should be >= 0.92`);
    assert.equal(result.breakdown.identityMultiplier, 1.0);
    assert.equal(result.breakdown.corroborationMultiplier, 1.0);
    assert.equal(result.breakdown.reasonablenessMultiplier, 1.0);
  });

  // ── Test 2: Hard impossibility (COGS > Revenue) → BLOCKED ────────

  it("hard impossibility (COGS > Revenue) → BLOCKED regardless of other gates", () => {
    // Reasonableness check: COGS exceeds revenue
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 500000,
      COST_OF_GOODS_SOLD: 600000,  // IMPOSSIBLE: COGS > Revenue
      GROSS_PROFIT: -100000,
      TOTAL_ASSETS: 1000000,
      ORDINARY_BUSINESS_INCOME: 50000,
    };

    const reasonablenessChecks = checkReasonableness(facts, "FORM_1065");

    const cogsCheck = reasonablenessChecks.find(c => c.checkId === "COGS_EXCEEDS_REVENUE");
    assert.ok(cogsCheck, "COGS_EXCEEDS_REVENUE check should exist");
    assert.equal(cogsCheck.severity, "IMPOSSIBLE");
    assert.equal(cogsCheck.passed, false);

    // Even with perfect identity and corroboration, impossibility blocks
    const impossibleFailures = reasonablenessChecks.filter(
      r => r.severity === "IMPOSSIBLE" && !r.passed,
    ).length;

    const result = aggregateDocumentConfidence({
      fieldConfidenceScores: { GROSS_RECEIPTS: 0.98, COST_OF_GOODS_SOLD: 0.98 },
      identityCheckResult: { passedCount: 3, failedCount: 0, skippedCount: 0 },
      corroborationResult: { passedCount: 2, failedCount: 0, skippedCount: 0 },
      reasonablenessResult: { impossibleFailures, anomalousWarnings: 0 },
    });

    assert.equal(result.status, "BLOCKED");
    assert.ok(result.score < 0.75, `score ${result.score} should be < 0.75`);
    assert.equal(result.breakdown.reasonablenessMultiplier, 0.5);
  });

  // ── Test 3: Corroboration fails, identity passes → FLAGGED ────────

  it("corroboration fails but identity passes → FLAGGED (score between 0.75 and 0.92)", () => {
    // Corroboration: 1 failed, 1 passed
    const corroborationResult = { passedCount: 1, failedCount: 1, skippedCount: 0 };

    const result = aggregateDocumentConfidence({
      fieldConfidenceScores: {
        GROSS_RECEIPTS: 0.95,
        COST_OF_GOODS_SOLD: 0.95,
        TOTAL_ASSETS: 0.93,
      },
      identityCheckResult: { passedCount: 2, failedCount: 0, skippedCount: 1 },
      corroborationResult,
      reasonablenessResult: { impossibleFailures: 0, anomalousWarnings: 0 },
    });

    // fieldAvg ≈ 0.9433, corrobMultiplier = 0.8, identity = 1.0, reasonableness = 1.0
    // score ≈ 0.9433 × 0.8 = 0.7547
    assert.equal(result.status, "FLAGGED");
    assert.ok(result.score >= 0.75, `score ${result.score} should be >= 0.75`);
    assert.ok(result.score < 0.92, `score ${result.score} should be < 0.92`);
    assert.equal(result.breakdown.corroborationMultiplier, 0.8);
    assert.equal(result.breakdown.identityMultiplier, 1.0);
  });

  // ── Test 4: All anomalous warnings, no hard failures → penalty but may AUTO_VERIFY

  it("all anomalous warnings, no hard failures → score penalty applied but may still AUTO_VERIFY", () => {
    // High field confidence + only anomalous warnings (reasonablenessMultiplier = 0.9)
    const result = aggregateDocumentConfidence({
      fieldConfidenceScores: {
        GROSS_RECEIPTS: 0.99,
        COST_OF_GOODS_SOLD: 0.99,
        GROSS_PROFIT: 0.99,
        TOTAL_DEDUCTIONS: 0.99,
        ORDINARY_BUSINESS_INCOME: 0.99,
      },
      identityCheckResult: { passedCount: 3, failedCount: 0, skippedCount: 0 },
      corroborationResult: { passedCount: 2, failedCount: 0, skippedCount: 0 },
      reasonablenessResult: { impossibleFailures: 0, anomalousWarnings: 2 },
    });

    // fieldAvg = 0.99, all multipliers 1.0 except reasonableness = 0.9
    // score = 0.99 × 0.9 = 0.891 → FLAGGED (penalty applied, just under 0.92)
    assert.equal(result.breakdown.reasonablenessMultiplier, 0.9);
    assert.ok(result.score < 0.99, `score ${result.score} should be penalized below fieldAvg`);

    // With even higher field confidence, could still auto-verify
    const result2 = aggregateDocumentConfidence({
      fieldConfidenceScores: {
        GROSS_RECEIPTS: 1.0,
        COST_OF_GOODS_SOLD: 1.0,
        GROSS_PROFIT: 1.0,
        TOTAL_DEDUCTIONS: 1.0,
        ORDINARY_BUSINESS_INCOME: 1.0,
        TOTAL_ASSETS: 1.0,
      },
      identityCheckResult: { passedCount: 3, failedCount: 0, skippedCount: 0 },
      corroborationResult: { passedCount: 2, failedCount: 0, skippedCount: 0 },
      reasonablenessResult: { impossibleFailures: 0, anomalousWarnings: 1 },
    });

    // score = 1.0 × 0.9 = 0.90 — still FLAGGED (under 0.92)
    // This confirms anomalous warnings apply a real penalty
    assert.equal(result2.breakdown.reasonablenessMultiplier, 0.9);
    assert.ok(result2.score <= 0.90 + 0.001, `score ${result2.score} should be ≤ 0.90`);
  });

  // ── Test 5: Empty field confidence scores → defaults to 0.85 ──────

  it("empty field confidence scores → defaults to 0.85 baseline, still computes correctly", () => {
    const result = aggregateDocumentConfidence({
      fieldConfidenceScores: {},
      identityCheckResult: { passedCount: 2, failedCount: 0, skippedCount: 1 },
      corroborationResult: { passedCount: 0, failedCount: 0, skippedCount: 3 },
      reasonablenessResult: { impossibleFailures: 0, anomalousWarnings: 0 },
    });

    assert.equal(result.breakdown.fieldAvg, 0.85);
    assert.equal(result.breakdown.identityMultiplier, 1.0);
    assert.equal(result.breakdown.corroborationMultiplier, 1.0);
    assert.equal(result.breakdown.reasonablenessMultiplier, 1.0);
    assert.equal(result.score, 0.85);
    // 0.85 < 0.92 → FLAGGED
    assert.equal(result.status, "FLAGGED");
  });
});
