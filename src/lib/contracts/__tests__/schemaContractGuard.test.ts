/**
 * Schema-Contract Remediation Guard Tests
 *
 * Ensures code writes/reads use actual DB column names from migrations.
 * Run with: node --import tsx --test src/lib/contracts/__tests__/schemaContractGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: Shared mapper module exists
// ============================================================================

describe("Guard 1: Shared row mapper module", () => {
  const mapperPath = join(ROOT, "src/lib/contracts/phase66b66cRowMappers.ts");

  it("mapper module exists", () => {
    assert.ok(existsSync(mapperPath));
  });

  it("exports scopeToMaterialityScore", () => {
    assert.ok(readFileSync(mapperPath, "utf-8").includes("export function scopeToMaterialityScore"));
  });

  it("exports materialChangeRowToDomain", () => {
    assert.ok(readFileSync(mapperPath, "utf-8").includes("export function materialChangeRowToDomain"));
  });

  it("exports agentHandoffRowToDomain", () => {
    assert.ok(readFileSync(mapperPath, "utf-8").includes("export function agentHandoffRowToDomain"));
  });

  it("exports actionRecommendationToRow", () => {
    assert.ok(readFileSync(mapperPath, "utf-8").includes("export function actionRecommendationToRow"));
  });
});

// ============================================================================
// Guard 2: Material change uses correct DB columns
// ============================================================================

describe("Guard 2: Material change schema alignment", () => {
  const path = join(ROOT, "src/lib/runtime/materiality/materialChangeEngine.ts");

  it("insert uses buddy_research_mission_id (not bare mission_id)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("buddy_research_mission_id:"));
    // The insert block should NOT have a standalone "mission_id:" key (without buddy_ prefix)
    const insertBlock = code.slice(code.indexOf(".insert({"), code.indexOf(".select(\"id\")"));
    assert.ok(!insertBlock.includes("\n      mission_id:"), "Insert must use buddy_research_mission_id, not mission_id");
  });

  it("insert uses change_scope (not scope)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("change_scope:"));
  });

  it("insert uses materiality_score (not materiality)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("materiality_score:"));
  });

  it("insert uses affected_systems_json (not invalidation_plan)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("affected_systems_json:"));
    assert.ok(!code.includes("invalidation_plan:"));
  });

  it("insert uses reuse_plan_json (not reuse_plan)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("reuse_plan_json:"));
  });

  it("materiality maps to valid DB enum values", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("scopeToMaterialityScore"), "Must use scopeToMaterialityScore for DB enum");
  });

  it("read path uses materialChangeRowToDomain mapper", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("materialChangeRowToDomain"));
  });
});

// ============================================================================
// Guard 3: Agent handoff uses correct DB columns
// ============================================================================

describe("Guard 3: Agent handoff schema alignment", () => {
  const path = join(ROOT, "src/lib/agents/agentHandoff.ts");

  it("insert uses from_agent_type (not from_agent)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("from_agent_type:"));
  });

  it("insert uses to_agent_type (not to_agent)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("to_agent_type:"));
  });

  it("insert uses visibility_scope (not visibility)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("visibility_scope: input.visibility"));
  });

  it("insert uses task_contract_json (not task_contract)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("task_contract_json:"));
  });

  it("insert uses result_summary_json (not result)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("result_summary_json:"));
  });

  it("does NOT write brief as standalone column", () => {
    const code = readFileSync(path, "utf-8");
    // brief should be inside task_contract_json, not a standalone insert field
    const insertBlock = code.slice(code.indexOf(".insert({"), code.indexOf("return handoffResult"));
    assert.ok(!insertBlock.includes("\n    brief,"), "brief must not be a standalone column");
  });

  it("read path uses agentHandoffRowToDomain mapper", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("agentHandoffRowToDomain"));
  });
});

// ============================================================================
// Guard 4: Action recommendation uses correct DB columns
// ============================================================================

describe("Guard 4: Action recommendation schema alignment", () => {
  const path = join(ROOT, "src/lib/decisioning/nextBestAction.ts");

  it("uses actionRecommendationToRow mapper", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("actionRecommendationToRow"));
  });

  it("does NOT insert raw visibility/actor/category (old names)", () => {
    const code = readFileSync(path, "utf-8");
    // The old broken pattern was: visibility: r.visibility, actor: r.actor
    assert.ok(
      !code.includes("visibility: r.visibility") && !code.includes("actor: r.actor"),
      "Must not use old column names in insert",
    );
  });
});

// ============================================================================
// Guard 5: Trust event uses correct DB columns
// ============================================================================

describe("Guard 5: Trust event schema alignment", () => {
  const path = join(ROOT, "src/lib/trust/bankerTrustCalibration.ts");

  it("insert uses payload_json (not payload)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("payload_json:"));
  });

  it("summary uses recommendation_accepted (not acceptance)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes('"recommendation_accepted"'));
    assert.ok(!code.includes('"acceptance"'));
  });

  it("summary uses recommendation_rejected (not rejection)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes('"recommendation_rejected"'));
    assert.ok(!code.includes('"rejection"'));
  });
});

// ============================================================================
// Guard 6: Outcomes route selects actual columns
// ============================================================================

describe("Guard 6: Outcomes route schema alignment", () => {
  const path = join(ROOT, "src/app/api/deals/[dealId]/outcomes/route.ts");

  it("selects outcome_status from recommendation_outcomes (not outcome_type)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("outcome_status"));
    assert.ok(!code.includes("outcome_type"));
  });

  it("selects payload_json from trust events (not evidence_json)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("payload_json"));
  });

  it("selects readiness_score_before from uplift (not before_score)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("readiness_score_before"));
    assert.ok(!code.includes("before_score"));
  });

  it("selects action_key from borrower actions (not action_type)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("action_key"));
    assert.ok(!code.includes("action_type"));
  });

  it("uses shared row mappers", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("phase66b66cRowMappers"));
  });
});

// ============================================================================
// Guard 7: Borrower-progress route selects actual columns
// ============================================================================

describe("Guard 7: Borrower-progress route schema alignment", () => {
  const path = join(ROOT, "src/app/api/deals/[dealId]/borrower-progress/route.ts");

  it("selects action_key (not action_type)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("action_key"));
    assert.ok(!code.includes("action_type"));
  });

  it("selects readiness_score_before (not before_score)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("readiness_score_before"));
    assert.ok(!code.includes("before_score"));
  });

  it("uses shared row mappers", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("phase66b66cRowMappers"));
  });
});
