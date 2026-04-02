/**
 * Phase 66C — Guard Tests
 *
 * Invariant guards for the Live Outcome Dominance layer.
 * Run with: node --import tsx --test src/lib/research/__tests__/phase66cGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

const migPath = join(ROOT, "supabase/migrations/20260604_phase_66c_live_outcome_dominance.sql");

// ============================================================================
// Guard 1: Migration completeness + tenant isolation
// ============================================================================

describe("Guard 1: Migration has all 11 tables with tenant isolation", () => {
  it("migration file exists", () => {
    assert.ok(existsSync(migPath));
  });

  const requiredTables = [
    "buddy_outcome_events",
    "buddy_outcome_snapshots",
    "buddy_recommendation_outcomes",
    "buddy_borrower_actions_taken",
    "buddy_readiness_uplift_snapshots",
    "buddy_banker_trust_events",
    "buddy_tuning_candidates",
    "buddy_tuning_decisions",
    "buddy_feedback_events",
    "buddy_experiments",
    "buddy_experiment_assignments",
  ];

  it("creates all 11 required tables", () => {
    const sql = readFileSync(migPath, "utf-8");
    for (const table of requiredTables) {
      assert.ok(sql.includes(table), `Must create ${table}`);
    }
  });

  it("tenant-scoped tables have bank_id", () => {
    const sql = readFileSync(migPath, "utf-8");
    // Tables that must have bank_id NOT NULL (excludes tuning_decisions which refs via candidate)
    const bankIdRequired = [
      "buddy_outcome_events",
      "buddy_outcome_snapshots",
      "buddy_recommendation_outcomes",
      "buddy_borrower_actions_taken",
      "buddy_readiness_uplift_snapshots",
      "buddy_banker_trust_events",
      "buddy_feedback_events",
      "buddy_experiment_assignments",
    ];
    for (const table of bankIdRequired) {
      // Find the CREATE TABLE block for this table
      const tableIdx = sql.indexOf(`create table if not exists ${table}`);
      assert.ok(tableIdx >= 0, `${table} CREATE TABLE must exist`);
      const blockEnd = sql.indexOf("create ", tableIdx + 10);
      const block = sql.slice(tableIdx, blockEnd > 0 ? blockEnd : undefined);
      assert.ok(
        block.includes("bank_id uuid not null references banks(id)"),
        `${table} must have bank_id NOT NULL FK`,
      );
    }
  });

  it("RLS enabled on all 11 tables", () => {
    const sql = readFileSync(migPath, "utf-8");
    for (const table of requiredTables) {
      assert.ok(
        sql.includes(`alter table ${table} enable row level security`),
        `RLS must be on ${table}`,
      );
    }
  });
});

// ============================================================================
// Guard 2: Outcome measurement system
// ============================================================================

describe("Guard 2: Outcome measurement", () => {
  it("outcomeMetrics exists and is pure", () => {
    const p = join(ROOT, "src/lib/outcomes/outcomeMetrics.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("outcomeAttribution persists to correct table", () => {
    const p = join(ROOT, "src/lib/outcomes/outcomeAttribution.ts");
    assert.ok(existsSync(p));
    assert.ok(readFileSync(p, "utf-8").includes("buddy_outcome_events"));
  });

  it("outcomeSnapshots exists", () => {
    assert.ok(existsSync(join(ROOT, "src/lib/outcomes/outcomeSnapshots.ts")));
  });

  it("outcomeRollups exists", () => {
    assert.ok(existsSync(join(ROOT, "src/lib/outcomes/outcomeRollups.ts")));
  });
});

// ============================================================================
// Guard 3: Recommendation quality engine
// ============================================================================

describe("Guard 3: Recommendation quality", () => {
  it("recommendationQuality is pure", () => {
    const p = join(ROOT, "src/lib/recommendations/recommendationQuality.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("recommendationDecay is pure", () => {
    const p = join(ROOT, "src/lib/recommendations/recommendationDecay.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("recommendationReRanker uses live data", () => {
    const p = join(ROOT, "src/lib/recommendations/recommendationReRanker.ts");
    assert.ok(existsSync(p));
    const code = readFileSync(p, "utf-8");
    assert.ok(code.includes("buddy_recommendation_outcomes") || code.includes("buddy_action_recommendations"));
  });
});

// ============================================================================
// Guard 4: Borrower uplift tracking
// ============================================================================

describe("Guard 4: Borrower behavior uplift", () => {
  for (const file of ["borrowerActionTracking", "readinessUplift", "guidanceEffectiveness", "milestoneCompletion"]) {
    it(`${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, `src/lib/borrowerOutcomes/${file}.ts`)));
    });
  }

  it("borrowerActionTracking persists to correct table", () => {
    const code = readFileSync(join(ROOT, "src/lib/borrowerOutcomes/borrowerActionTracking.ts"), "utf-8");
    assert.ok(code.includes("buddy_borrower_actions_taken"));
  });
});

// ============================================================================
// Guard 5: Trust calibration adapts to overrides
// ============================================================================

describe("Guard 5: Banker trust calibration", () => {
  it("bankerTrustCalibration records events", () => {
    const code = readFileSync(join(ROOT, "src/lib/trust/bankerTrustCalibration.ts"), "utf-8");
    assert.ok(code.includes("buddy_banker_trust_events"));
  });

  it("trustModelAdjustments is pure and computes shifts", () => {
    const p = join(ROOT, "src/lib/trust/trustModelAdjustments.ts");
    assert.ok(existsSync(p));
    const code = readFileSync(p, "utf-8");
    assert.ok(!code.includes("SupabaseClient"));
    assert.ok(code.includes("confidenceShift"));
  });

  it("overrideAnalytics exists", () => {
    assert.ok(existsSync(join(ROOT, "src/lib/trust/overrideAnalytics.ts")));
  });
});

// ============================================================================
// Guard 6: Feedback normalization
// ============================================================================

describe("Guard 6: Human feedback capture", () => {
  it("feedbackTaxonomy is pure", () => {
    const p = join(ROOT, "src/lib/feedback/feedbackTaxonomy.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("feedbackNormalizer is pure", () => {
    const p = join(ROOT, "src/lib/feedback/feedbackNormalizer.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("overrideCapture persists to buddy_feedback_events", () => {
    const code = readFileSync(join(ROOT, "src/lib/feedback/overrideCapture.ts"), "utf-8");
    assert.ok(code.includes("buddy_feedback_events"));
  });

  it("feedbackToLearning creates tuning candidates", () => {
    const code = readFileSync(join(ROOT, "src/lib/feedback/feedbackToLearning.ts"), "utf-8");
    assert.ok(code.includes("buddy_tuning_candidates"));
  });
});

// ============================================================================
// Guard 7: Tuning safety
// ============================================================================

describe("Guard 7: Production tuning safety", () => {
  it("tuningSafetyChecks is pure", () => {
    const p = join(ROOT, "src/lib/tuning/tuningSafetyChecks.ts");
    assert.ok(existsSync(p));
    assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
  });

  it("tuningRegistry defines constraints", () => {
    const code = readFileSync(join(ROOT, "src/lib/tuning/tuningRegistry.ts"), "utf-8");
    assert.ok(code.includes("maxChangePercent") || code.includes("TUNING_CONSTRAINTS"));
  });

  it("rankingTuner validates safety before proposing", () => {
    const code = readFileSync(join(ROOT, "src/lib/tuning/rankingTuner.ts"), "utf-8");
    assert.ok(code.includes("validate") || code.includes("safety") || code.includes("Safe"));
  });
});

// ============================================================================
// Guard 8: Experiment safety
// ============================================================================

describe("Guard 8: Experiment guardrails", () => {
  it("experimentGuardrails blocks forbidden domains", () => {
    const code = readFileSync(join(ROOT, "src/lib/experiments/experimentGuardrails.ts"), "utf-8");
    assert.ok(code.includes("FORBIDDEN_DOMAINS") || code.includes("forbidden"));
    assert.ok(code.includes("permissions") || code.includes("tenant_isolation"));
  });

  it("experimentRegistry validates before creating", () => {
    const code = readFileSync(join(ROOT, "src/lib/experiments/experimentRegistry.ts"), "utf-8");
    assert.ok(code.includes("validate") || code.includes("guardrail") || code.includes("Guardrail"));
  });

  it("experiments require rollback condition", () => {
    const code = readFileSync(join(ROOT, "src/lib/experiments/experimentGuardrails.ts"), "utf-8");
    assert.ok(code.includes("rollback") || code.includes("Rollback"));
  });
});

// ============================================================================
// Guard 9: Scoring models
// ============================================================================

describe("Guard 9: Scoring models are pure", () => {
  for (const file of ["bankerDominanceScore", "borrowerUpliftScore", "systemEfficiencyScore"]) {
    it(`${file} exists and is pure`, () => {
      const p = join(ROOT, `src/lib/scoring/${file}.ts`);
      assert.ok(existsSync(p));
      assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
    });
  }
});

// ============================================================================
// Guard 10: Presentation tuning
// ============================================================================

describe("Guard 10: Presentation tuning", () => {
  for (const file of ["livePriorityTuning", "noiseSuppression", "outcomeAwareNarratives"]) {
    it(`${file} exists and is pure`, () => {
      const p = join(ROOT, `src/lib/presentation/${file}.ts`);
      assert.ok(existsSync(p));
      assert.ok(!readFileSync(p, "utf-8").includes("SupabaseClient"));
    });
  }

  it("noiseSuppression has banker and borrower paths", () => {
    const code = readFileSync(join(ROOT, "src/lib/presentation/noiseSuppression.ts"), "utf-8");
    assert.ok(code.includes("Banker") || code.includes("banker"));
    assert.ok(code.includes("Borrower") || code.includes("borrower"));
  });
});

// ============================================================================
// Guard 11: No canonical envelope duplication
// ============================================================================

describe("Guard 11: Architectural boundaries", () => {
  it("no new mission envelope in migration", () => {
    const sql = readFileSync(migPath, "utf-8");
    assert.ok(!sql.includes("create table if not exists buddy_research_missions"));
  });

  it("no forbidden experiment domains allowed", () => {
    const code = readFileSync(join(ROOT, "src/lib/experiments/experimentGuardrails.ts"), "utf-8");
    // Must block at least permissions and tenant_isolation
    assert.ok(code.includes("permission") || code.includes("Permission"));
    assert.ok(code.includes("tenant") || code.includes("Tenant") || code.includes("isolation"));
  });
});
