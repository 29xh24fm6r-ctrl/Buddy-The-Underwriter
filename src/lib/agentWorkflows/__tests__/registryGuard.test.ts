/**
 * Phase 72A — Workflow Registry Guard Tests
 *
 * Validates that the workflow registry remains a pure documentation layer.
 * No execution code, no Supabase, no server-only imports.
 *
 * Run with: node --import tsx --test src/lib/agentWorkflows/__tests__/registryGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const REGISTRY_PATH = join(ROOT, "src/lib/agentWorkflows/registry.ts");

// ============================================================================
// Guard 1: Registry file exists
// ============================================================================

describe("Guard 1: Registry file exists", () => {
  it("registry.ts exists", () => {
    assert.ok(existsSync(REGISTRY_PATH), "registry.ts must exist");
  });
});

// ============================================================================
// Guard 2: Zero execution imports
// ============================================================================

describe("Guard 2: No execution code imports", () => {
  const source = readFileSync(REGISTRY_PATH, "utf-8");

  it("does not import runMission", () => {
    assert.ok(
      !source.match(/import.*from.*runMission/),
      "must not import runMission",
    );
  });

  it("does not import executeCanonicalAction", () => {
    assert.ok(
      !source.match(/import.*from.*executeCanonicalAction/),
      "must not import executeCanonicalAction",
    );
  });

  it("does not import orchestrator", () => {
    assert.ok(
      !source.match(/import.*from.*orchestrator/),
      "must not import orchestrator",
    );
  });

  it("does not import AgentOrchestrator", () => {
    assert.ok(
      !source.match(/import.*AgentOrchestrator/),
      "must not import AgentOrchestrator",
    );
  });
});

// ============================================================================
// Guard 3: No Supabase or server-only references
// ============================================================================

describe("Guard 3: No Supabase or server-only", () => {
  const source = readFileSync(REGISTRY_PATH, "utf-8");

  it("does not reference SupabaseClient", () => {
    assert.ok(
      !source.includes("SupabaseClient"),
      "must not reference SupabaseClient",
    );
  });

  it("does not reference createClient", () => {
    assert.ok(
      !source.includes("createClient"),
      "must not reference createClient",
    );
  });

  it("does not import from supabase", () => {
    assert.ok(
      !source.match(/import.*from.*supabase/i),
      "must not import supabase",
    );
  });

  it("does not import server-only", () => {
    assert.ok(
      !source.includes("server-only"),
      "must not import server-only",
    );
  });
});

// ============================================================================
// Guard 4: Registry is frozen
// ============================================================================

describe("Guard 4: Registry immutability", () => {
  const source = readFileSync(REGISTRY_PATH, "utf-8");

  it("WORKFLOW_REGISTRY is wrapped in Object.freeze", () => {
    assert.ok(
      source.includes("Object.freeze"),
      "WORKFLOW_REGISTRY must be frozen",
    );
  });
});

// ============================================================================
// Guard 5: Every entry has all required fields
// ============================================================================

describe("Guard 5: Entry completeness", () => {
  // Import dynamically to validate at runtime
  it("all 6 entries exist with required fields", async () => {
    const {
      WORKFLOW_REGISTRY,
      getAllWorkflowCodes,
    } = await import("../registry");

    const codes = getAllWorkflowCodes();
    assert.ok(codes.length >= 7, `expected >= 7 entries, got ${codes.length}`);

    const requiredKeys: (keyof typeof WORKFLOW_REGISTRY.research_bundle_generation)[] = [
      "code",
      "label",
      "description",
      "sourceTable",
      "sourceIdColumn",
      "statusColumn",
      "statusValues",
      "costMetrics",
      "requiresCanonicalState",
      "triggerType",
      "ownerSystem",
    ];

    for (const code of codes) {
      const entry = WORKFLOW_REGISTRY[code];
      for (const key of requiredKeys) {
        assert.ok(
          (entry as Record<string, unknown>)[key] !== undefined,
          `${code} missing required field: ${key}`,
        );
      }
      // code field must match the key
      assert.strictEqual(
        entry.code,
        code,
        `${code}.code must match its registry key`,
      );
    }
  });
});

// ============================================================================
// Guard 6: Source tables are known
// ============================================================================

describe("Guard 6: Source tables reference real tables", () => {
  it("all sourceTable values are in the known set", async () => {
    const { WORKFLOW_REGISTRY, getAllWorkflowCodes } = await import(
      "../registry"
    );

    const knownTables = new Set([
      "buddy_research_missions",
      "deal_extraction_runs",
      "deal_reconciliation_results",
      "canonical_action_executions",
      "borrower_request_campaigns",
      "draft_borrower_requests",
    ]);

    for (const code of getAllWorkflowCodes()) {
      const entry = WORKFLOW_REGISTRY[code];
      assert.ok(
        knownTables.has(entry.sourceTable),
        `${code}.sourceTable "${entry.sourceTable}" is not in the known set`,
      );
    }
  });
});

// ============================================================================
// Guard 7: requiresCanonicalState correctness
// ============================================================================

describe("Guard 7: Canonical state anchoring", () => {
  it("document_extraction does NOT require canonical state", async () => {
    const { WORKFLOW_REGISTRY } = await import("../registry");
    assert.strictEqual(
      WORKFLOW_REGISTRY.document_extraction.requiresCanonicalState,
      false,
      "document_extraction is system-triggered, does not need canonical state",
    );
  });

  it("research_bundle_generation requires canonical state", async () => {
    const { WORKFLOW_REGISTRY } = await import("../registry");
    assert.strictEqual(
      WORKFLOW_REGISTRY.research_bundle_generation.requiresCanonicalState,
      true,
    );
  });

  it("canonical_action_execution requires canonical state", async () => {
    const { WORKFLOW_REGISTRY } = await import("../registry");
    assert.strictEqual(
      WORKFLOW_REGISTRY.canonical_action_execution.requiresCanonicalState,
      true,
    );
  });

  it("at least 4 workflows require canonical state", async () => {
    const { WORKFLOW_REGISTRY, getAllWorkflowCodes } = await import(
      "../registry"
    );
    const count = getAllWorkflowCodes().filter(
      (c) => WORKFLOW_REGISTRY[c].requiresCanonicalState,
    ).length;
    assert.ok(count >= 4, `expected >= 4, got ${count}`);
  });
});

// ============================================================================
// Guard 8: Registry file does NOT call getBuddyCanonicalState
// ============================================================================

describe("Guard 8: Registry is pure data (no function calls)", () => {
  const source = readFileSync(REGISTRY_PATH, "utf-8");

  it("does not call getBuddyCanonicalState", () => {
    assert.ok(
      !source.includes("getBuddyCanonicalState"),
      "registry must not call getBuddyCanonicalState — it is pure data",
    );
  });

  it("does not call fetch or await", () => {
    // Registry should be synchronous pure data
    assert.ok(
      !source.match(/\bawait\b/),
      "registry must not use await — it is synchronous pure data",
    );
    assert.ok(
      !source.match(/\bfetch\b\s*\(/),
      "registry must not call fetch",
    );
  });
});
