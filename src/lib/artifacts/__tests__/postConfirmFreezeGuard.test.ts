/**
 * CI Guard — Post-Confirm Snapshot Integrity
 *
 * Once a deal enters CONFIRMED_READY_FOR_PROCESSING, the document set
 * is immutably sealed. No classification, supersession, stamping, or
 * routing writes are allowed. Late artifacts are truthfully deferred.
 *
 * These guards are structural. Freeze is integrity.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NOTE: We do NOT import from processArtifact.ts because it transitively
// imports server-only. CI guards must be pure — source-code assertions only.

// ── Source file readers ──────────────────────────────────────────────────

function readSrc(relPath: string): string {
  // __dirname = src/lib/artifacts/__tests__
  // Project root = 4 levels up
  return readFileSync(resolve(__dirname, "../../../..", relPath), "utf-8");
}

describe("Post-Confirm Freeze CI Guards", () => {
  // ── Guard 1: Frozen phases are exactly the 4 expected values ─────────
  test("[guard-1] POST_CONFIRM_FROZEN_PHASES contains exactly the 4 sealed phases", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    const expected = [
      "CONFIRMED_READY_FOR_PROCESSING",
      "PROCESSING",
      "PROCESSING_COMPLETE",
      "PROCESSING_COMPLETE_WITH_ERRORS",
    ];

    // Verify export exists
    assert.ok(
      src.includes("export const POST_CONFIRM_FROZEN_PHASES"),
      "POST_CONFIRM_FROZEN_PHASES must be exported from processArtifact.ts",
    );

    // Verify each phase is present in the constant
    for (const phase of expected) {
      assert.ok(
        src.includes(`"${phase}"`),
        `POST_CONFIRM_FROZEN_PHASES must contain "${phase}"`,
      );
    }

    // Extract the array literal and verify no extra phases
    const match = src.match(
      /POST_CONFIRM_FROZEN_PHASES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
    );
    assert.ok(match, "Must be a const assertion array");
    const arrayBody = match![1];
    const phases = arrayBody.match(/"[^"]+"/g) ?? [];
    assert.equal(
      phases.length,
      expected.length,
      `Expected exactly ${expected.length} phases, got ${phases.length}: ${phases.join(", ")}`,
    );
  });

  // ── Guard 2: processArtifact reads intake_phase before mutation ──────
  test("[guard-2] processArtifact.ts reads intake_phase before manual override check", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    // Freeze gate must appear before manual override check
    const freezeIdx = src.indexOf("Post-Confirm Freeze Gate");
    const manualIdx = src.indexOf("Check for manual override");

    assert.ok(freezeIdx > -1, "Freeze gate comment must exist in processArtifact.ts");
    assert.ok(manualIdx > -1, "Manual override check must exist in processArtifact.ts");
    assert.ok(
      freezeIdx < manualIdx,
      "Freeze gate must appear BEFORE manual override check",
    );

    // Must read intake_phase
    assert.ok(
      src.includes('.select("intake_phase")'),
      "Freeze gate must read intake_phase from deals",
    );
  });

  // ── Guard 3: Artifact status set to deferred_post_confirm ────────────
  test("[guard-3] processArtifact.ts sets status to deferred_post_confirm (not classified, not failed)", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    // Extract the freeze gate block
    const freezeStart = src.indexOf("Post-Confirm Freeze Gate");
    const freezeEnd = src.indexOf("STEP 0: Check for manual override");
    assert.ok(freezeStart > -1 && freezeEnd > -1, "Freeze gate section must be bounded");

    const freezeBlock = src.slice(freezeStart, freezeEnd);

    assert.ok(
      freezeBlock.includes('"deferred_post_confirm"'),
      "Freeze gate must set status to deferred_post_confirm",
    );

    // Must NOT set status to classified or failed within the freeze block
    assert.ok(
      !freezeBlock.includes('status: "classified"'),
      "Freeze gate must NOT set status to classified",
    );
    assert.ok(
      !freezeBlock.includes('status: "failed"'),
      "Freeze gate must NOT set status to failed",
    );
  });

  // ── Guard 4: Ledger event emitted ────────────────────────────────────
  test("[guard-4] processArtifact.ts emits intake.artifact_deferred_post_confirm event", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    assert.ok(
      src.includes('"intake.artifact_deferred_post_confirm"'),
      "Must emit intake.artifact_deferred_post_confirm ledger event",
    );
  });

  // ── Guard 5: Confirm route blocks on in-flight artifacts ─────────────
  test("[guard-5] confirm route checks for in-flight artifacts before sealing", () => {
    const src = readSrc("src/app/api/deals/[dealId]/intake/confirm/route.ts");

    assert.ok(
      src.includes('"queued"') && src.includes('"processing"'),
      "Confirm route must check for queued and processing artifact statuses",
    );

    assert.ok(
      src.includes('"artifacts_in_flight"'),
      "Confirm route must return artifacts_in_flight error",
    );

    assert.ok(
      src.includes('"intake.confirmation_blocked_inflight"'),
      "Confirm route must emit intake.confirmation_blocked_inflight event",
    );
  });

  // ── Guard 6: invalidateIntakeSnapshot is NOT modified ────────────────
  test("[guard-6] invalidateIntakeSnapshot.ts is unmodified — mutation prevented at source, not suppressed", () => {
    const src = readSrc("src/lib/intake/confirmation/invalidateIntakeSnapshot.ts");

    // Must NOT contain any freeze-related logic
    assert.ok(
      !src.includes("POST_CONFIRM_FROZEN_PHASES"),
      "invalidateIntakeSnapshot must NOT reference POST_CONFIRM_FROZEN_PHASES",
    );

    assert.ok(
      !src.includes("deferred_post_confirm"),
      "invalidateIntakeSnapshot must NOT reference deferred_post_confirm",
    );

    assert.ok(
      !src.includes("intake_processing_run_id"),
      "invalidateIntakeSnapshot must NOT check intake_processing_run_id",
    );

    // Must still only check CONFIRMED_READY_FOR_PROCESSING
    assert.ok(
      src.includes('intake_phase !== "CONFIRMED_READY_FOR_PROCESSING"'),
      "invalidateIntakeSnapshot must still check only CONFIRMED_READY_FOR_PROCESSING",
    );
  });
});
