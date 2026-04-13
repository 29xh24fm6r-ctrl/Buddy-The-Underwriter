/**
 * Phase 75 — Canonical State Anchor Guard Tests
 *
 * Validates that workflows marked requiresCanonicalState
 * correctly anchor to getBuddyCanonicalState().
 *
 * Run with: node --import tsx --test src/lib/agentWorkflows/__tests__/canonicalStateGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: Canonical state adapter exists
// ============================================================================

describe("Guard 1: Canonical state adapter exists", () => {
  it("BuddyCanonicalStateAdapter.ts exists", () => {
    assert.ok(
      existsSync(
        join(ROOT, "src/core/state/BuddyCanonicalStateAdapter.ts"),
      ),
      "BuddyCanonicalStateAdapter.ts must exist",
    );
  });

  it("exports getBuddyCanonicalState", () => {
    const source = readFileSync(
      join(ROOT, "src/core/state/BuddyCanonicalStateAdapter.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes("getBuddyCanonicalState"),
      "must export getBuddyCanonicalState",
    );
  });
});

// ============================================================================
// Guard 2: Registry canonical state flags are correct
// ============================================================================

describe("Guard 2: Registry canonical state flags", () => {
  it("document_extraction does NOT require canonical state", async () => {
    const { WORKFLOW_REGISTRY } = await import("../registry");
    assert.strictEqual(
      WORKFLOW_REGISTRY.document_extraction.requiresCanonicalState,
      false,
      "document_extraction is system-triggered and independent of canonical state",
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

  it("borrower_draft_request requires canonical state", async () => {
    const { WORKFLOW_REGISTRY } = await import("../registry");
    assert.strictEqual(
      WORKFLOW_REGISTRY.borrower_draft_request.requiresCanonicalState,
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
// Guard 3: Registry is pure data — never calls canonical state itself
// ============================================================================

describe("Guard 3: Registry purity", () => {
  const source = readFileSync(
    join(ROOT, "src/lib/agentWorkflows/registry.ts"),
    "utf-8",
  );

  it("registry does not call getBuddyCanonicalState", () => {
    assert.ok(
      !source.includes("getBuddyCanonicalState"),
      "registry must not call getBuddyCanonicalState — it is pure data",
    );
  });

  it("registry does not import from core/state", () => {
    assert.ok(
      !source.match(/import.*from.*core\/state/),
      "registry must not import from core/state",
    );
  });
});

// ============================================================================
// Guard 4: Canonical state returns blockers (contract check)
// ============================================================================

describe("Guard 4: Canonical state returns blockers", () => {
  it("BuddyCanonicalState type includes blockers field", () => {
    const source = readFileSync(
      join(ROOT, "src/core/state/BuddyCanonicalStateAdapter.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes("blockers"),
      "BuddyCanonicalState must include blockers field",
    );
  });
});
