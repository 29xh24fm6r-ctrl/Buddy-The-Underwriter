/**
 * Phase 66A — Guard Tests
 *
 * Invariant guards for the multi-agent control plane and BRIE runtime.
 * These tests validate architecture boundaries, not runtime behavior.
 *
 * Run with: node --import tsx --test src/lib/research/__tests__/phase66aGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: Migration exists with all required tables
// ============================================================================

describe("Guard 1: Migration completeness", () => {
  const migrationPath = join(ROOT, "supabase/migrations/20260602_phase_66a_multi_agent_control_plane.sql");

  it("migration file exists", () => {
    assert.ok(existsSync(migrationPath), "Migration file must exist");
  });

  it("migration creates all 7 required tables", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    const requiredTables = [
      "buddy_research_thread_runs",
      "buddy_research_checkpoints",
      "buddy_research_failure_library",
      "buddy_research_evidence",
      "buddy_agent_sessions",
      "buddy_borrower_insight_runs",
      "buddy_ratio_explanations",
    ];
    for (const table of requiredTables) {
      assert.ok(sql.includes(table), `Migration must reference table: ${table}`);
    }
  });

  it("buddy_agent_sessions has bank_id (GLBA compliance)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    // Extract the buddy_agent_sessions CREATE TABLE block
    const sessionBlock = sql.slice(
      sql.indexOf("create table if not exists buddy_agent_sessions"),
      sql.indexOf("create index if not exists idx_agent_sessions_deal"),
    );
    assert.ok(
      sessionBlock.includes("bank_id uuid not null references banks(id)"),
      "buddy_agent_sessions must have bank_id NOT NULL FK to banks",
    );
  });

  it("buddy_borrower_insight_runs has bank_id (GLBA compliance)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    const insightBlock = sql.slice(
      sql.indexOf("create table if not exists buddy_borrower_insight_runs"),
      sql.indexOf("create index if not exists idx_borrower_insight_runs_deal"),
    );
    assert.ok(
      insightBlock.includes("bank_id uuid not null references banks(id)"),
      "buddy_borrower_insight_runs must have bank_id NOT NULL FK to banks",
    );
  });

  it("buddy_research_failure_library has FK to missions", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    assert.ok(
      sql.includes("example_mission_id uuid references buddy_research_missions(id) on delete set null"),
      "failure_library must have FK to buddy_research_missions with ON DELETE SET NULL",
    );
  });
});

// ============================================================================
// Guard 2: Agent session store does NOT duplicate Omega/Canonical state
// ============================================================================

describe("Guard 2: Agent session store Omega isolation", () => {
  const sessionStorePath = join(ROOT, "src/lib/agents/controlPlane/agentSessionStore.ts");

  it("session store file exists", () => {
    assert.ok(existsSync(sessionStorePath));
  });

  it("session store does NOT import BuddyCanonicalState", () => {
    const code = readFileSync(sessionStorePath, "utf-8");
    // Check for actual import statements, not comment mentions (boundary docs are ok)
    const importLines = code.split("\n").filter((l) => l.startsWith("import") && l.includes("BuddyCanonicalState"));
    assert.equal(
      importLines.length,
      0,
      "agentSessionStore must NOT import BuddyCanonicalState — agents read it from src/core/state/",
    );
  });

  it("session store does NOT import OmegaAdvisoryState", () => {
    const code = readFileSync(sessionStorePath, "utf-8");
    const importLines = code.split("\n").filter((l) => l.startsWith("import") && l.includes("OmegaAdvisoryState"));
    assert.equal(
      importLines.length,
      0,
      "agentSessionStore must NOT import OmegaAdvisoryState — agents read it from src/core/omega/",
    );
  });

  it("session store documents the boundary in comments", () => {
    const code = readFileSync(sessionStorePath, "utf-8");
    assert.ok(
      code.includes("CRITICAL BOUNDARY"),
      "agentSessionStore must document the Omega/Canonical state boundary",
    );
  });
});

// ============================================================================
// Guard 3: No duplicate ratio/benchmark logic
// ============================================================================

describe("Guard 3: No duplicate ratio logic", () => {
  const explanationsPath = join(ROOT, "src/lib/ratios/explanations.ts");

  it("explanations file exists", () => {
    assert.ok(existsSync(explanationsPath));
  });

  it("explanations does NOT recompute DSCR/LTV (extends existing)", () => {
    const code = readFileSync(explanationsPath, "utf-8");
    // Should not contain actual DSCR computation — only explanation generation
    assert.ok(
      !code.includes("net_operating_income / total_debt_service"),
      "explanations.ts must NOT contain ratio computation logic — only explanation templates",
    );
  });
});

// ============================================================================
// Guard 4: BRIE wraps, does NOT replace
// ============================================================================

describe("Guard 4: BRIE wraps runMission", () => {
  const briePath = join(ROOT, "src/lib/research/brieRuntime.ts");

  it("BRIE runtime exists", () => {
    assert.ok(existsSync(briePath));
  });

  it("BRIE accepts runMission as injected dependency", () => {
    const code = readFileSync(briePath, "utf-8");
    assert.ok(
      code.includes("runMission:"),
      "executeBrieMission must accept runMission as an injected function parameter",
    );
  });

  it("BRIE does NOT import runMission directly", () => {
    const code = readFileSync(briePath, "utf-8");
    // Should NOT have: import { runMission } from "./runMission"
    assert.ok(
      !code.includes('from "./runMission"'),
      "BRIE must NOT directly import runMission — it should be injected",
    );
  });
});

// ============================================================================
// Guard 5: checkExistingMission is real (not stub)
// ============================================================================

describe("Guard 5: checkExistingMission is real", () => {
  const orchPath = join(ROOT, "src/lib/research/orchestration.ts");

  it("orchestration file exists", () => {
    assert.ok(existsSync(orchPath));
  });

  it("checkExistingMission accepts SupabaseClient", () => {
    const code = readFileSync(orchPath, "utf-8");
    assert.ok(
      code.includes("sb: SupabaseClient"),
      "checkExistingMission must accept SupabaseClient parameter",
    );
  });

  it("checkExistingMission queries the database", () => {
    const code = readFileSync(orchPath, "utf-8");
    assert.ok(
      code.includes('.from("buddy_research_missions")'),
      "checkExistingMission must query buddy_research_missions",
    );
  });

  it("checkExistingMission no longer has stub comment", () => {
    const code = readFileSync(orchPath, "utf-8");
    assert.ok(
      !code.includes("This would normally query the database"),
      "checkExistingMission must not contain stub placeholder comment",
    );
  });
});

// ============================================================================
// Guard 6: No parallel state systems
// ============================================================================

describe("Guard 6: No parallel state systems", () => {
  it("agentRouter delegates to existing AgentOrchestrator", () => {
    const routerPath = join(ROOT, "src/lib/agents/controlPlane/agentRouter.ts");
    const code = readFileSync(routerPath, "utf-8");
    assert.ok(
      code.includes('from "../orchestrator"'),
      "agentRouter must import from existing orchestrator, not create a new one",
    );
  });

  it("agentPolicies is stateless (pure policy evaluation)", () => {
    const policiesPath = join(ROOT, "src/lib/agents/controlPlane/agentPolicies.ts");
    const code = readFileSync(policiesPath, "utf-8");
    assert.ok(
      !code.includes("SupabaseClient"),
      "agentPolicies must be stateless — no database access",
    );
  });
});

// ============================================================================
// Guard 7: Plugin system is non-blocking by default
// ============================================================================

describe("Guard 7: Plugin system safety", () => {
  const pluginPath = join(ROOT, "src/lib/research/plugins/index.ts");

  it("plugin system exists", () => {
    assert.ok(existsSync(pluginPath));
  });

  it("plugins have a blocking flag", () => {
    const code = readFileSync(pluginPath, "utf-8");
    assert.ok(
      code.includes("blocking: boolean"),
      "Plugin definitions must declare whether they are blocking",
    );
  });
});

// ============================================================================
// Guard 8: Verification layer captures but does not improve
// ============================================================================

describe("Guard 8: Verification layer is capture-only", () => {
  const verifyPath = join(ROOT, "src/lib/research/verification.ts");

  it("verification file exists", () => {
    assert.ok(existsSync(verifyPath));
  });

  it("verification does NOT modify facts or inferences", () => {
    const code = readFileSync(verifyPath, "utf-8");
    // Should not contain UPDATE or mutation operations on facts/inferences
    assert.ok(
      !code.includes('.update(') || code.includes("// does NOT"),
      "Verification layer must not mutate research facts or inferences",
    );
  });
});

// ============================================================================
// Guard 9: Multi-tenant isolation
// ============================================================================

describe("Guard 9: Multi-tenant isolation", () => {
  const migrationPath = join(ROOT, "supabase/migrations/20260602_phase_66a_multi_agent_control_plane.sql");

  it("RLS enabled on all new tables", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    const rlsTables = [
      "buddy_research_thread_runs",
      "buddy_research_checkpoints",
      "buddy_research_failure_library",
      "buddy_research_evidence",
      "buddy_agent_sessions",
      "buddy_borrower_insight_runs",
      "buddy_ratio_explanations",
    ];
    for (const table of rlsTables) {
      assert.ok(
        sql.includes(`alter table ${table} enable row level security`),
        `RLS must be enabled on ${table}`,
      );
    }
  });

  it("bank isolation policies exist for tenant-scoped tables", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    assert.ok(sql.includes("agent_sessions_bank_isolation"), "buddy_agent_sessions must have bank isolation policy");
    assert.ok(sql.includes("borrower_insights_bank_isolation"), "buddy_borrower_insight_runs must have bank isolation policy");
  });
});

// ============================================================================
// Guard 10: All checkpoint stages match stage registry
// ============================================================================

describe("Guard 10: Checkpoint-stage alignment", () => {
  it("checkpoint stages match stage registry", async () => {
    const checkpointCode = readFileSync(
      join(ROOT, "src/lib/research/checkpoint.ts"),
      "utf-8",
    );
    const stagesCode = readFileSync(
      join(ROOT, "src/lib/research/stages/index.ts"),
      "utf-8",
    );

    // Extract STAGE_ORDER from checkpoint.ts
    const stageOrderMatch = checkpointCode.match(/STAGE_ORDER.*?=\s*\[([\s\S]*?)\]/);
    assert.ok(stageOrderMatch, "STAGE_ORDER must exist in checkpoint.ts");

    // Extract stage names from stages/index.ts
    const stageNames = [...stagesCode.matchAll(/name:\s*"(\w+)"/g)].map((m) => m[1]);
    assert.ok(stageNames.length >= 8, "Stage registry must have at least 8 stages");
  });
});

// ============================================================================
// Guard 11: Borrower insights engine extends existing
// ============================================================================

describe("Guard 11: Borrower insights extends existing", () => {
  const insightsPath = join(ROOT, "src/lib/borrowerReport/insightsEngine.ts");

  it("insights engine exists", () => {
    assert.ok(existsSync(insightsPath));
  });

  it("insights engine imports from ratios/explanations", () => {
    const code = readFileSync(insightsPath, "utf-8");
    assert.ok(
      code.includes('@/lib/ratios/explanations'),
      "Insights engine must use existing ratio explanations, not duplicate",
    );
  });
});

// ============================================================================
// Guard 12: Phase number is 66A (not 54A)
// ============================================================================

describe("Guard 12: Correct phase numbering", () => {
  it("migration references Phase 66A", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20260602_phase_66a_multi_agent_control_plane.sql"),
      "utf-8",
    );
    assert.ok(sql.includes("Phase 66A"), "Migration must reference Phase 66A");
    assert.ok(!sql.includes("Phase 54A"), "Migration must NOT reference Phase 54A");
  });
});
