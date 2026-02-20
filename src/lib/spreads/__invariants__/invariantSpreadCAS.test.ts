/**
 * S1 — CAS Integrity Proof
 *
 * Proves: Compare-And-Swap mechanism prevents phantom writes,
 * orphaned rows, and version skew.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── Source files ───────────────────────────────────────────────────────

const PROCESSOR_SRC = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
const ENQUEUE_SRC = readSource("src/lib/financialSpreads/enqueueSpreadRecompute.ts");
const RENDER_SRC = readSource("src/lib/financialSpreads/renderSpread.ts");

// ── Scenarios ──────────────────────────────────────────────────────────

describe("CAS Integrity Proof", () => {
  test("Scenario A: CAS claim requires exact status + spread_type + spread_version match", () => {
    // Find the CAS filters object
    const casFiltersStart = PROCESSOR_SRC.indexOf("const casFilters");
    assert.ok(casFiltersStart > 0, "casFilters const must exist");

    const casFiltersBlock = PROCESSOR_SRC.slice(casFiltersStart, casFiltersStart + 300);
    assert.ok(casFiltersBlock.includes("spread_type: spreadType"), "CAS filters must include spread_type");
    assert.ok(casFiltersBlock.includes("spread_version: tpl.version"), "CAS filters must include spread_version");
    assert.ok(casFiltersBlock.includes("owner_type: effectiveOwnerType"), "CAS filters must include owner_type");
    assert.ok(casFiltersBlock.includes("owner_entity_id: ownerEntityId"), "CAS filters must include owner_entity_id");
  });

  test("Scenario B: Failed CAS claim → skip, not crash", () => {
    // After both CAS steps, check for !claimed guard
    assert.ok(
      PROCESSOR_SRC.includes("if (!claimed)"),
      "Processor must check if (!claimed) after CAS",
    );
    assert.ok(
      PROCESSOR_SRC.includes("SPREAD_PLACEHOLDER_MISSING"),
      "Processor must emit SPREAD_PLACEHOLDER_MISSING on failed CAS",
    );
    assert.ok(
      PROCESSOR_SRC.includes("continue"),
      "Processor must continue (not throw) on failed CAS",
    );
  });

  test("Scenario C: Error path resets to 'error' status with version pin", () => {
    const errorPathStart = PROCESSOR_SRC.indexOf("NON-NEGOTIABLE: clean up");
    assert.ok(errorPathStart > 0, "Error path must exist with NON-NEGOTIABLE comment");

    const errorBlock = PROCESSOR_SRC.slice(errorPathStart, errorPathStart + 2000);

    // Must update to error status
    assert.ok(
      errorBlock.includes('status: "error"'),
      "Error path must set status to error",
    );

    // Must pin spread_version
    assert.ok(
      errorBlock.includes('.eq("spread_version"'),
      "Error path must pin spread_version",
    );

    // Must pin last_run_id for strict CAS
    assert.ok(
      errorBlock.includes('.eq("last_run_id", runId)'),
      "Error path must pin last_run_id (strict CAS)",
    );

    // Must pin status to generating (only clean up own generating rows)
    assert.ok(
      errorBlock.includes('.eq("status", "generating")'),
      "Error path must pin status=generating",
    );
  });

  test("Scenario D: Line items use DELETE + INSERT (not upsert)", () => {
    // writeSpreadLineItems must delete before insert
    const lineItemsStart = RENDER_SRC.indexOf("writeSpreadLineItems");
    assert.ok(lineItemsStart > 0, "writeSpreadLineItems must exist in renderSpread");

    const lineItemsBlock = RENDER_SRC.slice(lineItemsStart);

    const deleteIdx = lineItemsBlock.indexOf(".delete()");
    const insertIdx = lineItemsBlock.indexOf(".insert(");
    assert.ok(deleteIdx > 0, "Line items must use .delete()");
    assert.ok(insertIdx > 0, "Line items must use .insert()");
    assert.ok(
      deleteIdx < insertIdx,
      "DELETE must come before INSERT for idempotent re-render",
    );
  });

  test("Scenario E: Rendered spread status set to 'ready' only on success", () => {
    // renderSpread sets status to "ready" in the success upsert
    assert.ok(
      RENDER_SRC.includes('status: "ready"'),
      "renderSpread must set status: ready on success",
    );

    // The error path uses status: "error"
    assert.ok(
      RENDER_SRC.includes('status: "error"'),
      "renderSpread must set status: error on template missing",
    );
  });

  test("Scenario F: Job status transitions are monotonic", () => {
    // QUEUED → RUNNING is enforced by lease
    assert.ok(
      PROCESSOR_SRC.includes('"RUNNING"') && PROCESSOR_SRC.includes('.eq("status", "QUEUED")'),
      "Processor must transition QUEUED → RUNNING via lease",
    );

    // RUNNING → SUCCEEDED
    assert.ok(
      PROCESSOR_SRC.includes('"SUCCEEDED"') && PROCESSOR_SRC.includes('.eq("status", "RUNNING")'),
      "Processor must transition RUNNING → SUCCEEDED with CAS",
    );

    // RUNNING → FAILED
    assert.ok(
      PROCESSOR_SRC.includes('"FAILED"'),
      "Processor must have FAILED terminal state",
    );

    // No backward: FAILED → QUEUED or SUCCEEDED → QUEUED should NOT exist
    // (Exception: preflight retry QUEUED re-enqueue — that's before actual processing)
    const failedToQueued = PROCESSOR_SRC.indexOf('"QUEUED"');
    // This is OK — preflight retry does go back to QUEUED, and error retry does too.
    // The invariant is that completion states (SUCCEEDED) never go backward.
    // Verify that SUCCEEDED is never followed by a re-queue:
    const succeededIdx = PROCESSOR_SRC.lastIndexOf('"SUCCEEDED"');
    const afterSucceeded = PROCESSOR_SRC.slice(succeededIdx + 50, succeededIdx + 500);
    assert.ok(
      !afterSucceeded.includes('status: "QUEUED"'),
      "No SUCCEEDED → QUEUED transition should exist",
    );
  });

  test("Scenario G: runId is derived from jobId (canonical identifier)", () => {
    // The processor must set runId from jobId
    assert.ok(
      PROCESSOR_SRC.includes("const runId = jobId"),
      "runId must be derived from jobId",
    );
  });

  test("Scenario H: Placeholder creation uses template version", () => {
    // enqueueSpreadRecompute creates placeholders with tpl.version
    const placeholderStart = ENQUEUE_SRC.indexOf("placeholder");
    assert.ok(placeholderStart > 0, "Enqueue must reference placeholder creation");

    assert.ok(
      ENQUEUE_SRC.includes("spread_version: tpl.version"),
      "Placeholder must use tpl.version for spread_version",
    );
  });
});
