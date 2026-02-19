/**
 * Intake Governance — CI Guards (Phase C)
 *
 * 9 guards that protect core intake governance safety properties:
 *   1. isIntakeSloEnforcementEnabled() → false when env var absent
 *   2. isIntakeSloEnforcementEnabled() → false when set to "0" or "false", true when "true"
 *   3. computeIntakeHealthScore returns 100 when all inputs false (healthy baseline)
 *   4. computeIntakeHealthScore returns 0 when all deductions applied (floor = 0)
 *   5. computeIntakeHealthScore is deterministic — same input produces same score twice
 *   6. computeIntakeHealthScore deduction audit trail is accurate (sum of deductions matches)
 *   7. computeIntakeHealthScore never returns a value outside [0, 100]
 *   8. computeIntakeHealthScore does NOT stack identical-category deductions (no-stacking invariant)
 *   9. HEALTH_SCORE_VERSION constant is exported and equals "health_v1"
 *
 * Pure function tests — no DB, no IO, no server-only imports.
 * Imports only from computeIntakeHealthScore.ts and flags/intakeSloEnforcement.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeIntakeHealthScore,
  HEALTH_SCORE_VERSION,
} from "../computeIntakeHealthScore";
import type { IntakeHealthInput } from "../computeIntakeHealthScore";
import { isIntakeSloEnforcementEnabled } from "../../../flags/intakeSloEnforcement";

// ---------------------------------------------------------------------------
// Guard 1: isIntakeSloEnforcementEnabled() → false when env var absent
// ---------------------------------------------------------------------------

test("Guard 1: isIntakeSloEnforcementEnabled() → false when ENABLE_INTAKE_SLO_ENFORCEMENT absent", () => {
  const originalVal = process.env.ENABLE_INTAKE_SLO_ENFORCEMENT;
  delete process.env.ENABLE_INTAKE_SLO_ENFORCEMENT;

  assert.strictEqual(
    isIntakeSloEnforcementEnabled(),
    false,
    "Flag must be false when ENABLE_INTAKE_SLO_ENFORCEMENT is not set",
  );

  // Restore
  if (originalVal === undefined) {
    delete process.env.ENABLE_INTAKE_SLO_ENFORCEMENT;
  } else {
    process.env.ENABLE_INTAKE_SLO_ENFORCEMENT = originalVal;
  }

  console.log(`[intakeReliabilityGuard] Guard 1: flag=false when absent ✓`);
});

// ---------------------------------------------------------------------------
// Guard 2: isIntakeSloEnforcementEnabled() → false for "0"/"false", true for "true"
// ---------------------------------------------------------------------------

test("Guard 2: isIntakeSloEnforcementEnabled() → false when '0' or 'false', true when 'true'", () => {
  const originalVal = process.env.ENABLE_INTAKE_SLO_ENFORCEMENT;

  process.env.ENABLE_INTAKE_SLO_ENFORCEMENT = "false";
  assert.strictEqual(
    isIntakeSloEnforcementEnabled(),
    false,
    "Flag must be false when ENABLE_INTAKE_SLO_ENFORCEMENT=false",
  );

  process.env.ENABLE_INTAKE_SLO_ENFORCEMENT = "0";
  assert.strictEqual(
    isIntakeSloEnforcementEnabled(),
    false,
    "Flag must be false when ENABLE_INTAKE_SLO_ENFORCEMENT=0",
  );

  process.env.ENABLE_INTAKE_SLO_ENFORCEMENT = "true";
  assert.strictEqual(
    isIntakeSloEnforcementEnabled(),
    true,
    "Flag must be true when ENABLE_INTAKE_SLO_ENFORCEMENT=true",
  );

  // Restore
  if (originalVal === undefined) {
    delete process.env.ENABLE_INTAKE_SLO_ENFORCEMENT;
  } else {
    process.env.ENABLE_INTAKE_SLO_ENFORCEMENT = originalVal;
  }

  console.log(`[intakeReliabilityGuard] Guard 2: flag correctly gated ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: computeIntakeHealthScore returns 100 when all inputs false (healthy baseline)
// ---------------------------------------------------------------------------

test("Guard 3: computeIntakeHealthScore returns 100 when all inputs false (healthy baseline)", () => {
  const input: IntakeHealthInput = {
    hasReviewRequired: false,
    hasManualOverride: false,
    hasSegmentationFailed: false,
    queueBacklogActive: false,
    classificationSloViolation: false,
    workerUnhealthy: false,
  };

  const result = computeIntakeHealthScore(input);

  assert.strictEqual(
    result.score,
    100,
    "Score must be 100 when all inputs are false (no deductions)",
  );
  assert.strictEqual(
    result.deductions.length,
    0,
    "Deductions array must be empty when all inputs false",
  );
  assert.strictEqual(
    result.scoring_version,
    HEALTH_SCORE_VERSION,
    "scoring_version must equal HEALTH_SCORE_VERSION",
  );

  console.log(`[intakeReliabilityGuard] Guard 3: healthy baseline score=100 ✓`);
});

// ---------------------------------------------------------------------------
// Guard 4: computeIntakeHealthScore returns 0 when all deductions applied (floor = 0)
// ---------------------------------------------------------------------------

test("Guard 4: computeIntakeHealthScore returns 0 when all deductions applied (floor = 0)", () => {
  const input: IntakeHealthInput = {
    hasReviewRequired: true,       // -20
    hasManualOverride: true,       // -20
    hasSegmentationFailed: true,   // -30
    queueBacklogActive: true,      // -30
    classificationSloViolation: true, // -30
    workerUnhealthy: true,         // -20
    // Total: -150, floor = 0
  };

  const result = computeIntakeHealthScore(input);

  assert.strictEqual(
    result.score,
    0,
    "Score must be 0 when total deductions exceed 100 (floor enforced)",
  );
  assert.ok(
    result.deductions.length === 6,
    "All 6 deduction categories must be present",
  );

  console.log(`[intakeReliabilityGuard] Guard 4: floor=0 enforced, total deductions=${result.deductions.reduce((s, d) => s + d.points, 0)} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 5: computeIntakeHealthScore is deterministic — same input → same score twice
// ---------------------------------------------------------------------------

test("Guard 5: computeIntakeHealthScore is deterministic — same input produces same score twice", () => {
  const input: IntakeHealthInput = {
    hasReviewRequired: true,
    hasManualOverride: false,
    hasSegmentationFailed: true,
    queueBacklogActive: false,
    classificationSloViolation: false,
    workerUnhealthy: true,
  };

  const result1 = computeIntakeHealthScore(input);
  const result2 = computeIntakeHealthScore(input);

  assert.strictEqual(
    result1.score,
    result2.score,
    "Same input must produce identical score on every call",
  );
  assert.deepStrictEqual(
    result1.deductions,
    result2.deductions,
    "Same input must produce identical deductions on every call",
  );

  console.log(`[intakeReliabilityGuard] Guard 5: deterministic score=${result1.score} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 6: deduction audit trail is accurate (sum of deductions matches score delta)
// ---------------------------------------------------------------------------

test("Guard 6: computeIntakeHealthScore deduction audit trail is accurate (sum matches score delta)", () => {
  const input: IntakeHealthInput = {
    hasReviewRequired: true,
    hasManualOverride: true,
    hasSegmentationFailed: false,
    queueBacklogActive: true,
    classificationSloViolation: false,
    workerUnhealthy: false,
    // Expected deductions: review_required=20, manual_override=20, queue_backlog=30 → total=70
    // Expected score: 100 - 70 = 30
  };

  const result = computeIntakeHealthScore(input);
  const sumDeducted = result.deductions.reduce((acc, d) => acc + d.points, 0);

  assert.strictEqual(
    result.score,
    Math.max(0, 100 - sumDeducted),
    `Score must equal max(0, 100 - sumDeducted). Got score=${result.score}, sumDeducted=${sumDeducted}`,
  );
  assert.strictEqual(
    result.score,
    30,
    "Expected score=30 for this specific input combination",
  );
  assert.strictEqual(
    sumDeducted,
    70,
    "Expected total deductions=70 for this specific input combination",
  );

  console.log(`[intakeReliabilityGuard] Guard 6: audit trail accurate score=${result.score}, sumDeducted=${sumDeducted} ✓`);
});

// ---------------------------------------------------------------------------
// Guard 7: computeIntakeHealthScore never returns a value outside [0, 100]
// ---------------------------------------------------------------------------

test("Guard 7: computeIntakeHealthScore never returns a value outside [0, 100]", () => {
  const testCases: IntakeHealthInput[] = [
    // All false
    {
      hasReviewRequired: false,
      hasManualOverride: false,
      hasSegmentationFailed: false,
      queueBacklogActive: false,
      classificationSloViolation: false,
      workerUnhealthy: false,
    },
    // All true
    {
      hasReviewRequired: true,
      hasManualOverride: true,
      hasSegmentationFailed: true,
      queueBacklogActive: true,
      classificationSloViolation: true,
      workerUnhealthy: true,
    },
    // Partial
    {
      hasReviewRequired: true,
      hasManualOverride: false,
      hasSegmentationFailed: true,
      queueBacklogActive: false,
      classificationSloViolation: true,
      workerUnhealthy: false,
    },
    // Single deduction
    {
      hasReviewRequired: false,
      hasManualOverride: false,
      hasSegmentationFailed: true,
      queueBacklogActive: false,
      classificationSloViolation: false,
      workerUnhealthy: false,
    },
  ];

  for (const input of testCases) {
    const result = computeIntakeHealthScore(input);
    assert.ok(
      result.score >= 0 && result.score <= 100,
      `Score must be in [0, 100], got ${result.score} for input ${JSON.stringify(input)}`,
    );
  }

  console.log(`[intakeReliabilityGuard] Guard 7: all scores in [0, 100] ✓`);
});

// ---------------------------------------------------------------------------
// Guard 8: computeIntakeHealthScore does NOT stack identical-category deductions
// ---------------------------------------------------------------------------

test("Guard 8: computeIntakeHealthScore deductions array contains no duplicate reason strings", () => {
  // All inputs true → all categories fire exactly once
  const input: IntakeHealthInput = {
    hasReviewRequired: true,
    hasManualOverride: true,
    hasSegmentationFailed: true,
    queueBacklogActive: true,
    classificationSloViolation: true,
    workerUnhealthy: true,
  };

  const result = computeIntakeHealthScore(input);

  // Collect all reason strings
  const reasons = result.deductions.map((d) => d.reason);
  const uniqueReasons = new Set(reasons);

  assert.strictEqual(
    reasons.length,
    uniqueReasons.size,
    `Deductions array must not contain duplicate reasons. Got: ${JSON.stringify(reasons)}`,
  );

  // Verify each category appears exactly once
  const expectedCategories = [
    "review_required",
    "manual_override",
    "segmentation_failed",
    "queue_backlog",
    "classification_slo",
    "worker_unhealthy",
  ];
  for (const cat of expectedCategories) {
    const count = reasons.filter((r) => r === cat).length;
    assert.strictEqual(
      count,
      1,
      `Category '${cat}' must appear exactly once in deductions (no-stacking invariant). Got count=${count}`,
    );
  }

  console.log(`[intakeReliabilityGuard] Guard 8: no-stacking invariant — ${reasons.length} unique deductions ✓`);
});

// ---------------------------------------------------------------------------
// Guard 9: HEALTH_SCORE_VERSION constant is exported and equals "health_v1"
// ---------------------------------------------------------------------------

test("Guard 9: HEALTH_SCORE_VERSION constant is exported and equals 'health_v1'", () => {
  assert.strictEqual(
    HEALTH_SCORE_VERSION,
    "health_v1",
    "HEALTH_SCORE_VERSION must equal 'health_v1' for audit trail stability",
  );

  // Verify it is embedded in the result
  const input: IntakeHealthInput = {
    hasReviewRequired: false,
    hasManualOverride: false,
    hasSegmentationFailed: false,
    queueBacklogActive: false,
    classificationSloViolation: false,
    workerUnhealthy: false,
  };
  const result = computeIntakeHealthScore(input);

  assert.strictEqual(
    result.scoring_version,
    "health_v1",
    "scoring_version in result must equal 'health_v1'",
  );

  console.log(`[intakeReliabilityGuard] Guard 9: HEALTH_SCORE_VERSION='${HEALTH_SCORE_VERSION}' ✓`);
});
