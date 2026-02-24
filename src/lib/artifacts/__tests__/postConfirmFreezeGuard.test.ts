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

  // ── Guard 7: Supersession re-checks phase before invalidation (TOCTOU defense)
  test("[guard-7] processArtifact.ts re-reads intake_phase before supersession invalidation", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    // The supersession block must re-read intake_phase (TOCTOU defense)
    const supersessionIdx = src.indexOf('ssResult.outcome === "superseded"');
    assert.ok(supersessionIdx > -1, "Supersession check must exist");

    const supersessionBlock = src.slice(supersessionIdx, supersessionIdx + 1500);

    assert.ok(
      supersessionBlock.includes("phaseAtSupersession"),
      "Supersession block must re-read phase as phaseAtSupersession (TOCTOU defense)",
    );

    assert.ok(
      supersessionBlock.includes("POST_CONFIRM_FROZEN_PHASES.includes(phaseAtSupersession"),
      "Supersession block must check phaseAtSupersession against POST_CONFIRM_FROZEN_PHASES",
    );
  });

  // ── Guard 8: Supersession emits skipped event when frozen ─────────────
  test("[guard-8] processArtifact.ts emits intake.supersession_skipped_frozen when frozen", () => {
    const src = readSrc("src/lib/artifacts/processArtifact.ts");

    assert.ok(
      src.includes('"intake.supersession_skipped_frozen"'),
      "Must emit intake.supersession_skipped_frozen event when supersession is skipped due to frozen phase",
    );
  });

  // ── Guard 6: invalidateIntakeSnapshot has CAS guard — atomic, run-aware ──────
  test("[guard-6] invalidateIntakeSnapshot uses CAS guard — no regression when run is active", () => {
    const src = readSrc("src/lib/intake/confirmation/invalidateIntakeSnapshot.ts");

    // Must NOT contain freeze-related logic (that belongs in upload routes / processArtifact)
    assert.ok(
      !src.includes("POST_CONFIRM_FROZEN_PHASES"),
      "invalidateIntakeSnapshot must NOT reference POST_CONFIRM_FROZEN_PHASES",
    );

    assert.ok(
      !src.includes("deferred_post_confirm"),
      "invalidateIntakeSnapshot must NOT reference deferred_post_confirm",
    );

    // CAS: update must include .eq("intake_phase") re-check
    assert.ok(
      src.includes('.eq("intake_phase", "CONFIRMED_READY_FOR_PROCESSING")'),
      "invalidateIntakeSnapshot update must CAS-check intake_phase in WHERE clause",
    );

    // CAS: update must guard against active processing run
    assert.ok(
      src.includes('.is("intake_processing_run_id", null)'),
      "invalidateIntakeSnapshot update must guard .is(intake_processing_run_id, null)",
    );

    // Must emit blocked event when CAS prevents invalidation
    assert.ok(
      src.includes('"intake.snapshot_invalidation_blocked"'),
      "invalidateIntakeSnapshot must emit intake.snapshot_invalidation_blocked when CAS blocks",
    );

    // Must still read initial phase for early return
    assert.ok(
      src.includes('intake_phase !== "CONFIRMED_READY_FOR_PROCESSING"'),
      "invalidateIntakeSnapshot must still early-return on non-confirmed phase",
    );
  });
});

// ── Upload Route Freeze Guards ──────────────────────────────────────────

const UPLOAD_ROUTES = [
  "src/app/api/deals/[dealId]/files/record/route.ts",
  "src/app/api/portal/upload/commit/route.ts",
  "src/app/api/portal/[token]/files/record/route.ts",
  "src/app/api/public/upload/route.ts",
] as const;

describe("Upload Route Freeze CI Guards", () => {
  // ── Guard 9: Banker upload does NOT call invalidateIntakeSnapshot unconditionally
  test("[guard-9] files/record/route.ts has phase check before invalidateIntakeSnapshot", () => {
    const src = readSrc("src/app/api/deals/[dealId]/files/record/route.ts");

    // Must read intake_phase before calling invalidateIntakeSnapshot
    const phaseCheckIdx = src.indexOf("intake.upload_received_while_frozen");
    const invalidateIdx = src.indexOf("invalidateIntakeSnapshot(dealId");
    assert.ok(
      phaseCheckIdx > 0 && invalidateIdx > phaseCheckIdx,
      "files/record must check phase and emit frozen event BEFORE invalidation call",
    );
  });

  // ── Guard 10: Banker upload checks frozen phases before invalidation
  test("[guard-10] files/record/route.ts checks CONFIRMED_READY_FOR_PROCESSING before invalidation", () => {
    const src = readSrc("src/app/api/deals/[dealId]/files/record/route.ts");

    // Must contain all 4 frozen phase strings in the check
    assert.ok(
      src.includes('"CONFIRMED_READY_FOR_PROCESSING"') &&
      src.includes('"PROCESSING"') &&
      src.includes('"PROCESSING_COMPLETE"') &&
      src.includes('"PROCESSING_COMPLETE_WITH_ERRORS"'),
      "files/record must check all 4 frozen phases before invalidation",
    );

    // Must read intake_phase from DB
    assert.ok(
      src.includes('.select("intake_phase")'),
      "files/record must query intake_phase from deals table",
    );
  });

  // ── Guard 11: Banker upload emits truthful event when frozen
  test("[guard-11] files/record/route.ts emits intake.upload_received_while_frozen", () => {
    const src = readSrc("src/app/api/deals/[dealId]/files/record/route.ts");

    assert.ok(
      src.includes('"intake.upload_received_while_frozen"'),
      "files/record must emit intake.upload_received_while_frozen event when upload occurs during frozen phase",
    );
  });

  // ── Guard 12: ALL 4 upload routes have phase-safe gate before invalidation
  test("[guard-12] All upload routes check frozen phase before invalidateIntakeSnapshot", () => {
    for (const routePath of UPLOAD_ROUTES) {
      const src = readSrc(routePath);

      assert.ok(
        src.includes('"intake.upload_received_while_frozen"'),
        `${routePath} must emit intake.upload_received_while_frozen event`,
      );

      assert.ok(
        src.includes('"CONFIRMED_READY_FOR_PROCESSING"'),
        `${routePath} must check CONFIRMED_READY_FOR_PROCESSING before invalidation`,
      );
    }
  });
});
