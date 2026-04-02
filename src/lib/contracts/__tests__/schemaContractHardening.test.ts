/**
 * Schema-Contract Hardening Tests — Permanent Enforcement
 *
 * Three layers of protection:
 * 1. Mapper contract tests — row shape → stable domain shape
 * 2. Legacy identifier ban — fail if old column names reappear in runtime code
 * 3. Route contract tests — API responses use normalized shapes only
 *
 * Run with: node --import tsx --test src/lib/contracts/__tests__/schemaContractHardening.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// LAYER 1: Mapper Contract Tests
// ============================================================================

describe("Layer 1: Mapper contract — materialChangeRowToDomain", () => {
  // Import the mapper dynamically to test actual behavior
  it("maps all DB columns to domain names", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const row = {
      id: "abc-123",
      deal_id: "deal-1",
      bank_id: "bank-1",
      buddy_research_mission_id: "mission-1",
      change_type: "document_uploaded",
      change_scope: "localized",
      old_fingerprint: "fp-old",
      new_fingerprint: "fp-new",
      materiality_score: "low",
      affected_systems_json: { stages: ["extraction"] },
      reuse_plan_json: { reusable: ["ratios"] },
      created_at: "2026-04-02T00:00:00Z",
    };
    const domain = mod.materialChangeRowToDomain(row);
    assert.equal(domain.id, "abc-123");
    assert.equal(domain.dealId, "deal-1");
    assert.equal(domain.missionId, "mission-1");
    assert.equal(domain.scope, "localized");
    assert.equal(domain.materiality, "low");
    assert.deepEqual(domain.invalidationPlan, { stages: ["extraction"] });
    assert.deepEqual(domain.reusePlan, { reusable: ["ratios"] });
  });

  it("handles null mission_id", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const row = {
      id: "x", deal_id: "d", bank_id: "b", buddy_research_mission_id: null,
      change_type: "manual_override", change_scope: "trivial",
      old_fingerprint: null, new_fingerprint: null,
      materiality_score: "none", affected_systems_json: {}, reuse_plan_json: {},
      created_at: "2026-04-02T00:00:00Z",
    };
    const domain = mod.materialChangeRowToDomain(row);
    assert.equal(domain.missionId, null);
  });
});

describe("Layer 1: Mapper contract — scopeToMaterialityScore enum normalization", () => {
  it("normalizes all scope values to DB enum", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    assert.equal(mod.scopeToMaterialityScore("trivial"), "none");
    assert.equal(mod.scopeToMaterialityScore("localized"), "low");
    assert.equal(mod.scopeToMaterialityScore("material"), "medium");
    assert.equal(mod.scopeToMaterialityScore("mission_wide"), "critical");
  });

  it("defaults unknown scope to low", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    assert.equal(mod.scopeToMaterialityScore("unknown_value"), "low");
  });
});

describe("Layer 1: Mapper contract — agentHandoffRowToDomain", () => {
  it("maps DB columns to domain names", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const row = {
      id: "h-1", deal_id: "d-1", bank_id: "b-1",
      from_agent_type: "risk", to_agent_type: "research",
      visibility_scope: "banker", handoff_type: "data_request",
      status: "complete",
      task_contract_json: { purpose: "test", brief: { dealContext: {} } },
      result_summary_json: { from: "risk", to: "research" },
      created_at: "2026-04-02T00:00:00Z", completed_at: "2026-04-02T00:01:00Z",
    };
    const domain = mod.agentHandoffRowToDomain(row);
    assert.equal(domain.fromAgent, "risk");
    assert.equal(domain.toAgent, "research");
    assert.equal(domain.visibility, "banker");
    assert.deepEqual(domain.taskContract, row.task_contract_json);
    assert.deepEqual(domain.result, row.result_summary_json);
  });
});

describe("Layer 1: Mapper contract — actionRecommendationToRow", () => {
  it("maps domain to DB row with title/description in rationale_json", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const row = mod.actionRecommendationToRow("deal-1", "bank-1", {
      visibility: "banker",
      actor: "underwriter",
      category: "diligence_request",
      title: "Request missing docs",
      description: "Tax returns are missing",
      rationale: { evidenceStrength: "high" },
      blockedBy: {},
      expectedImpact: { impactEstimate: "high" },
      priorityScore: 85,
      urgencyScore: 90,
      confidence: "high",
    });
    assert.equal(row.visibility_scope, "banker");
    assert.equal(row.actor_type, "underwriter");
    assert.equal(row.action_category, "diligence_request");
    assert.equal(row.confidence_score, "high");
    assert.equal(row.rationale_json.title, "Request missing docs");
    assert.equal(row.rationale_json.description, "Tax returns are missing");
    assert.equal((row.rationale_json as Record<string, unknown>).evidenceStrength, "high");
  });

  it("omits title/description from rationale_json when not provided", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const row = mod.actionRecommendationToRow("d", "b", {
      visibility: "borrower", actor: "borrower", category: "cash_improvement",
      rationale: {}, blockedBy: {}, expectedImpact: {},
      priorityScore: 50, urgencyScore: 40, confidence: "medium",
    });
    assert.equal(row.rationale_json.title, undefined);
  });
});

describe("Layer 1: Mapper contract — API row mappers handle null/optional JSON", () => {
  it("trustEventRowToApi handles null payload_json", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const result = mod.trustEventRowToApi({
      id: "t-1", event_type: "override", conclusion_key: null,
      recommendation_id: null, payload_json: null, created_at: "2026-04-02T00:00:00Z",
    });
    assert.equal(result.payload, null);
    assert.equal(result.eventType, "override");
  });

  it("upliftRowToApi handles null scores", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const result = mod.upliftRowToApi({
      id: "u-1", readiness_score_before: null, readiness_score_after: null,
      uplift_summary_json: {}, created_at: "2026-04-02T00:00:00Z",
    });
    assert.equal(result.readinessScoreBefore, null);
    assert.equal(result.readinessScoreAfter, null);
  });

  it("borrowerActionRowToApi maps all fields", async () => {
    const mod = await import("../phase66b66cRowMappers.js");
    const result = mod.borrowerActionRowToApi({
      id: "a-1", action_key: "upload_tax_returns", action_source: "recommendation",
      status: "completed", evidence_json: { docId: "d-1" },
      completed_at: "2026-04-02T00:00:00Z", created_at: "2026-04-01T00:00:00Z",
    });
    assert.equal(result.actionKey, "upload_tax_returns");
    assert.equal(result.actionSource, "recommendation");
    assert.equal(result.status, "completed");
  });
});

// ============================================================================
// LAYER 2: Legacy Identifier Ban (CI Guardrail)
// ============================================================================

describe("Layer 2: Legacy identifier ban — runtime code scan", () => {
  /**
   * Banned legacy identifiers that must NOT appear as DB column references
   * in active runtime code for remediated modules.
   */
  const BANNED_PATTERNS = [
    // Material change legacy
    { pattern: /(?:^|\s)mission_id(?:\s*:|,|\))/m, label: "bare mission_id (use buddy_research_mission_id)" },
    { pattern: /(?:^|\s)invalidation_plan(?:\s*:|,|\))/m, label: "invalidation_plan (use affected_systems_json)" },
    { pattern: /(?:^|\s)reuse_plan(?:\s*:|,|\))(?!_json)/m, label: "reuse_plan without _json suffix" },
    // Agent handoff legacy
    { pattern: /(?:^|\s)from_agent(?:\s*:|,|\))(?!_type)/m, label: "from_agent without _type suffix" },
    { pattern: /(?:^|\s)to_agent(?:\s*:|,|\))(?!_type)/m, label: "to_agent without _type suffix" },
    // Trust event legacy
    { pattern: /"acceptance"/m, label: 'legacy "acceptance" event name (use "recommendation_accepted")' },
    { pattern: /"rejection"/m, label: 'legacy "rejection" event name (use "recommendation_rejected")' },
  ];

  /** Directories containing remediated runtime code */
  const SCAN_DIRS = [
    "src/lib/runtime/materiality",
    "src/lib/agents",
    "src/lib/decisioning",
    "src/lib/trust",
    "src/app/api/deals/[dealId]/outcomes",
    "src/app/api/deals/[dealId]/borrower-progress",
  ];

  /** Files explicitly excluded from scan (test fixtures, specs, migrations) */
  const EXCLUDED_FILES = new Set([
    "schemaContractGuard.test.ts",
    "schemaContractHardening.test.ts",
    "phase66bGuard.test.ts",
    "phase66cGuard.test.ts",
    "agentTaskContracts.ts",     // defines types, not DB writes
    "agentDelegationPolicy.ts",  // pure policy, no DB
    "agentPolicies.ts",          // pure policy, no DB
  ]);

  function collectTsFiles(dir: string): string[] {
    const absDir = join(ROOT, dir);
    if (!existsSync(absDir)) return [];
    const files: string[] = [];
    for (const entry of readdirSync(absDir)) {
      const full = join(absDir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        // Recurse into subdirectories (but skip __tests__)
        if (entry !== "__tests__" && entry !== "node_modules") {
          for (const sub of readdirSync(full)) {
            if (sub.endsWith(".ts") || sub.endsWith(".tsx")) {
              files.push(join(full, sub));
            }
          }
        }
      } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !EXCLUDED_FILES.has(entry)) {
        files.push(full);
      }
    }
    return files;
  }

  for (const { pattern, label } of BANNED_PATTERNS) {
    it(`no runtime file contains banned pattern: ${label}`, () => {
      const violations: string[] = [];
      for (const dir of SCAN_DIRS) {
        for (const file of collectTsFiles(dir)) {
          const code = readFileSync(file, "utf-8");
          if (pattern.test(code)) {
            const relPath = file.replace(ROOT + "/", "");
            violations.push(relPath);
          }
        }
      }
      assert.equal(
        violations.length,
        0,
        `Banned pattern "${label}" found in: ${violations.join(", ")}`,
      );
    });
  }
});

// ============================================================================
// LAYER 3: Route Contract Tests
// ============================================================================

describe("Layer 3: Route contract — outcomes route uses mappers", () => {
  const routePath = join(ROOT, "src/app/api/deals/[dealId]/outcomes/route.ts");

  it("imports from phase66b66cRowMappers", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("phase66b66cRowMappers"));
  });

  it("uses recOutcomeRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("recOutcomeRowToApi"));
  });

  it("uses trustEventRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("trustEventRowToApi"));
  });

  it("uses upliftRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("upliftRowToApi"));
  });

  it("uses borrowerActionRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("borrowerActionRowToApi"));
  });

  it("does NOT contain raw as-casts on query results", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(!code.includes(" as "), "Route must not cast raw rows");
  });
});

describe("Layer 3: Route contract — borrower-progress route uses mappers", () => {
  const routePath = join(ROOT, "src/app/api/deals/[dealId]/borrower-progress/route.ts");

  it("imports from phase66b66cRowMappers", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("phase66b66cRowMappers"));
  });

  it("uses borrowerActionRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("borrowerActionRowToApi"));
  });

  it("uses upliftRowToApi mapper", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("upliftRowToApi"));
  });
});

describe("Layer 3: Route contract — materialChangeEngine uses mapper for reads", () => {
  const path = join(ROOT, "src/lib/runtime/materiality/materialChangeEngine.ts");

  it("imports materialChangeRowToDomain", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("materialChangeRowToDomain"));
  });

  it("imports scopeToMaterialityScore", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("scopeToMaterialityScore"));
  });
});

describe("Layer 3: Route contract — agentHandoff uses mapper for reads", () => {
  const path = join(ROOT, "src/lib/agents/agentHandoff.ts");

  it("imports agentHandoffRowToDomain", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("agentHandoffRowToDomain"));
  });
});

describe("Layer 3: Route contract — nextBestAction uses mapper for writes", () => {
  const path = join(ROOT, "src/lib/decisioning/nextBestAction.ts");

  it("imports actionRecommendationToRow", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes("actionRecommendationToRow"));
  });
});

describe("Layer 3: Canonical trust event names enforced", () => {
  const path = join(ROOT, "src/lib/trust/bankerTrustCalibration.ts");

  it("uses recommendation_accepted (not acceptance)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes('"recommendation_accepted"'));
    assert.ok(!code.includes('"acceptance"'));
  });

  it("uses recommendation_rejected (not rejection)", () => {
    const code = readFileSync(path, "utf-8");
    assert.ok(code.includes('"recommendation_rejected"'));
    assert.ok(!code.includes('"rejection"'));
  });
});
