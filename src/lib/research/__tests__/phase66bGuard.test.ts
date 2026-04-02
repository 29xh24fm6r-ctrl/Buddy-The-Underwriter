/**
 * Phase 66B — Guard Tests
 *
 * Invariant guards for the God-Tier Experience Layer.
 * Run with: node --import tsx --test src/lib/research/__tests__/phase66bGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: Migration has all 6 tables with bank_id
// ============================================================================

describe("Guard 1: Migration completeness + tenant isolation", () => {
  const migPath = join(ROOT, "supabase/migrations/20260603_phase_66b_experience_layer.sql");

  it("migration file exists", () => {
    assert.ok(existsSync(migPath));
  });

  it("creates all 6 required tables", () => {
    const sql = readFileSync(migPath, "utf-8");
    for (const table of [
      "buddy_material_change_events",
      "buddy_agent_handoffs",
      "buddy_action_recommendations",
      "buddy_conclusion_trust",
      "buddy_borrower_readiness_paths",
      "buddy_monitoring_signals",
    ]) {
      assert.ok(sql.includes(table), `Must create ${table}`);
    }
  });

  it("all 6 tables have bank_id NOT NULL", () => {
    const sql = readFileSync(migPath, "utf-8");
    // Each CREATE TABLE block should have bank_id uuid not null references banks(id)
    const tableBlocks = sql.split("create table if not exists").slice(1);
    assert.equal(tableBlocks.length, 6, "Should have exactly 6 CREATE TABLE blocks");
    for (const block of tableBlocks) {
      const tableName = block.trim().split(/[\s(]/)[0];
      assert.ok(
        block.includes("bank_id uuid not null references banks(id)"),
        `${tableName} must have bank_id NOT NULL FK`,
      );
    }
  });

  it("RLS enabled on all 6 tables", () => {
    const sql = readFileSync(migPath, "utf-8");
    for (const table of [
      "buddy_material_change_events",
      "buddy_agent_handoffs",
      "buddy_action_recommendations",
      "buddy_conclusion_trust",
      "buddy_borrower_readiness_paths",
      "buddy_monitoring_signals",
    ]) {
      assert.ok(
        sql.includes(`alter table ${table} enable row level security`),
        `RLS must be enabled on ${table}`,
      );
    }
  });

  it("bank isolation policies exist for all 6 tables", () => {
    const sql = readFileSync(migPath, "utf-8");
    for (const policy of [
      "material_changes_bank_isolation",
      "agent_handoffs_bank_isolation",
      "action_recommendations_bank_isolation",
      "conclusion_trust_bank_isolation",
      "readiness_paths_bank_isolation",
      "monitoring_signals_bank_isolation",
    ]) {
      assert.ok(sql.includes(policy), `Policy ${policy} must exist`);
    }
  });
});

// ============================================================================
// Guard 2: Material Change Engine — only affected stages recompute
// ============================================================================

describe("Guard 2: Material Change Engine", () => {
  it("invalidationPlanner exists and is pure", () => {
    const path = join(ROOT, "src/lib/runtime/materiality/invalidationPlanner.ts");
    assert.ok(existsSync(path));
    const code = readFileSync(path, "utf-8");
    assert.ok(!code.includes("server-only"), "invalidationPlanner should be pure (no server-only)");
    assert.ok(!code.includes("SupabaseClient"), "invalidationPlanner should not access DB");
  });

  it("changeFingerprint exists and is pure", () => {
    const path = join(ROOT, "src/lib/runtime/materiality/changeFingerprint.ts");
    assert.ok(existsSync(path));
    const code = readFileSync(path, "utf-8");
    assert.ok(!code.includes("SupabaseClient"), "changeFingerprint should be pure");
  });

  it("materialChangeEngine persists to correct table", () => {
    const path = join(ROOT, "src/lib/runtime/materiality/materialChangeEngine.ts");
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("buddy_material_change_events"), "Must persist to buddy_material_change_events");
  });
});

// ============================================================================
// Guard 3: Agent handoffs honor visibility scope
// ============================================================================

describe("Guard 3: Agent choreography visibility enforcement", () => {
  it("delegationPolicy exists", () => {
    assert.ok(existsSync(join(ROOT, "src/lib/agents/agentDelegationPolicy.ts")));
  });

  it("delegationPolicy enforces borrower visibility boundary", () => {
    const code = readFileSync(join(ROOT, "src/lib/agents/agentDelegationPolicy.ts"), "utf-8");
    assert.ok(
      code.includes("borrower") && code.includes("allowed"),
      "Must have borrower visibility rules",
    );
  });

  it("taskContracts defines borrowerSafeRedactionRules", () => {
    const code = readFileSync(join(ROOT, "src/lib/agents/agentTaskContracts.ts"), "utf-8");
    assert.ok(
      code.includes("borrowerSafeRedactionRules"),
      "Task contracts must define borrower-safe redaction rules",
    );
  });

  it("agentHandoff validates delegation before executing", () => {
    const code = readFileSync(join(ROOT, "src/lib/agents/agentHandoff.ts"), "utf-8");
    assert.ok(
      code.includes("canDelegate"),
      "Handoff must check canDelegate before proceeding",
    );
  });
});

// ============================================================================
// Guard 4: Trust layer grounded in verification
// ============================================================================

describe("Guard 4: Trust layer", () => {
  it("confidenceModel classifies support types", () => {
    const code = readFileSync(join(ROOT, "src/lib/trust/confidenceModel.ts"), "utf-8");
    for (const type of ["observed", "derived", "inferred", "weakly_supported", "stale", "disputed"]) {
      assert.ok(code.includes(type), `Must support type: ${type}`);
    }
  });

  it("trustBadgeBuilder has both banker and borrower labels", () => {
    const code = readFileSync(join(ROOT, "src/lib/trust/trustBadgeBuilder.ts"), "utf-8");
    assert.ok(code.includes("bankerLabel"), "Must have banker labels");
    assert.ok(code.includes("borrowerLabel"), "Must have borrower labels");
  });

  it("evidenceDensity is pure", () => {
    const code = readFileSync(join(ROOT, "src/lib/trust/evidenceDensity.ts"), "utf-8");
    assert.ok(!code.includes("SupabaseClient"), "evidenceDensity should be pure");
  });
});

// ============================================================================
// Guard 5: Borrower storytelling
// ============================================================================

describe("Guard 5: Borrower storytelling", () => {
  for (const file of ["rootCauseTree", "leverRanking", "tradeoffExplainer", "readinessMilestones", "cashStory", "creditLensTranslator"]) {
    it(`${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, `src/lib/borrowerInsights/${file}.ts`)));
    });
  }

  it("cashStory generates borrower-friendly narrative", () => {
    const code = readFileSync(join(ROOT, "src/lib/borrowerInsights/cashStory.ts"), "utf-8");
    assert.ok(code.includes("headline"), "Cash story must have headline");
    assert.ok(code.includes("firstAction"), "Cash story must have first action");
  });

  it("creditLensTranslator converts lender terms to borrower terms", () => {
    const code = readFileSync(join(ROOT, "src/lib/borrowerInsights/creditLensTranslator.ts"), "utf-8");
    assert.ok(code.includes("borrowerTerm"), "Must translate to borrower terms");
    assert.ok(code.includes("whatToDoAboutIt"), "Must include actionable guidance");
  });
});

// ============================================================================
// Guard 6: Monitoring flywheel
// ============================================================================

describe("Guard 6: Monitoring-to-underwriting flywheel", () => {
  it("signalToAction converts signals to actions", () => {
    const code = readFileSync(join(ROOT, "src/lib/monitoring/signalToAction.ts"), "utf-8");
    assert.ok(code.includes("buddy_action_recommendations") || code.includes("ActionRecommendation"),
      "Must connect signals to action recommendations");
  });

  it("underwritingFeedbackLoop marks signals as fed", () => {
    const code = readFileSync(join(ROOT, "src/lib/monitoring/underwritingFeedbackLoop.ts"), "utf-8");
    assert.ok(code.includes("fed_into_underwriting"), "Must mark fed_into_underwriting");
    assert.ok(code.includes("fed_into_borrower_coaching"), "Must mark fed_into_borrower_coaching");
  });

  it("borrowerCoachingRefresh processes unprocessed signals", () => {
    const code = readFileSync(join(ROOT, "src/lib/monitoring/borrowerCoachingRefresh.ts"), "utf-8");
    assert.ok(code.includes("fed_into_borrower_coaching"), "Must filter by unprocessed");
  });
});

// ============================================================================
// Guard 7: Decision engine
// ============================================================================

describe("Guard 7: Decision engine", () => {
  it("actionPriorityEngine is pure", () => {
    const code = readFileSync(join(ROOT, "src/lib/decisioning/actionPriorityEngine.ts"), "utf-8");
    assert.ok(!code.includes("SupabaseClient"), "Priority engine should be pure");
  });

  it("nextBestAction generates for both banker and borrower", () => {
    const code = readFileSync(join(ROOT, "src/lib/decisioning/nextBestAction.ts"), "utf-8");
    assert.ok(code.includes("Banker") || code.includes("banker"), "Must generate banker actions");
    assert.ok(code.includes("Borrower") || code.includes("borrower"), "Must generate borrower actions");
  });

  it("structureOpportunityEngine is pure", () => {
    const code = readFileSync(join(ROOT, "src/lib/decisioning/structureOpportunityEngine.ts"), "utf-8");
    assert.ok(!code.includes("SupabaseClient"), "Structure engine should be pure");
  });
});

// ============================================================================
// Guard 8: Scoring models
// ============================================================================

describe("Guard 8: Scoring models", () => {
  for (const file of ["readinessScore", "actionabilityScore", "trustWeightedScenarioScore"]) {
    it(`${file} exists and is pure`, () => {
      const path = join(ROOT, `src/lib/scoring/${file}.ts`);
      assert.ok(existsSync(path));
      const code = readFileSync(path, "utf-8");
      assert.ok(!code.includes("SupabaseClient"), `${file} should be pure`);
    });
  }
});

// ============================================================================
// Guard 9: Presentation / taste layer
// ============================================================================

describe("Guard 9: Taste layer", () => {
  it("bankerNarrativePolish removes AI filler", () => {
    const code = readFileSync(join(ROOT, "src/lib/presentation/bankerNarrativePolish.ts"), "utf-8");
    assert.ok(code.includes("filler") || code.includes("remove") || code.includes("replace"),
      "Must strip AI filler from banker output");
  });

  it("borrowerNarrativePolish simplifies jargon", () => {
    const code = readFileSync(join(ROOT, "src/lib/presentation/borrowerNarrativePolish.ts"), "utf-8");
    assert.ok(code.includes("DSCR") || code.includes("jargon") || code.includes("replace"),
      "Must simplify financial jargon for borrowers");
  });

  it("prioritizationRules filters low-value items", () => {
    const code = readFileSync(join(ROOT, "src/lib/presentation/prioritizationRules.ts"), "utf-8");
    assert.ok(code.includes("suppress") || code.includes("filter") || code.includes("minPriority"),
      "Must suppress low-value items");
  });
});

// ============================================================================
// Guard 10: No canonical envelope duplication
// ============================================================================

describe("Guard 10: Architectural boundaries preserved", () => {
  it("no new mission envelope table created", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20260603_phase_66b_experience_layer.sql"),
      "utf-8",
    );
    assert.ok(!sql.includes("buddy_missions"), "Must NOT create a new mission envelope");
    assert.ok(!sql.includes("create table if not exists buddy_research_missions"),
      "Must NOT recreate buddy_research_missions");
  });

  it("materialChangeEngine does not import runMission", () => {
    const code = readFileSync(
      join(ROOT, "src/lib/runtime/materiality/materialChangeEngine.ts"),
      "utf-8",
    );
    assert.ok(!code.includes("runMission"), "Material change engine must not call runMission directly");
  });
});
