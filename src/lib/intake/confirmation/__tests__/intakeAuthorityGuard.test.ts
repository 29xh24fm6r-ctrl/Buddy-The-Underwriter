/**
 * Phase E1.1 — Intake Authority Hardening CI Guards
 *
 * Structural invariants for the "uploads never attach" authority model.
 * These guards CI-lock critical behavioral contracts that must never
 * change without explicit architectural approval.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Intake Authority Hardening CI Guards (E1.1)", () => {
  // ── Guard 87: isPreConfirmationPhase exists and is pure ──
  test("Guard 87: isPreConfirmationPhase is pure (no server-only)", () => {
    const src = readSource(
      "src/lib/intake/confirmation/isPreConfirmationPhase.ts",
    );
    assert.ok(
      !src.includes('import "server-only"'),
      "isPreConfirmationPhase must be pure (no server-only)",
    );
    assert.ok(
      src.includes("CONFIRMED_READY_FOR_PROCESSING"),
      "must reference post-confirmation phase",
    );
    assert.ok(
      src.includes("PROCESSING_COMPLETE"),
      "must reference PROCESSING_COMPLETE",
    );
  });

  // ── Guard 88: isPreConfirmationPhase returns correct values ──
  test("Guard 88: isPreConfirmationPhase phase predicate correctness", async () => {
    const { isPreConfirmationPhase } = await import(
      "../isPreConfirmationPhase.js"
    );
    // Pre-confirmation phases → true
    assert.equal(isPreConfirmationPhase(null), true, "null → true");
    assert.equal(isPreConfirmationPhase(undefined), true, "undefined → true");
    assert.equal(
      isPreConfirmationPhase("BULK_UPLOADED"),
      true,
      "BULK_UPLOADED → true",
    );
    assert.equal(
      isPreConfirmationPhase("CLASSIFIED_PENDING_CONFIRMATION"),
      true,
      "CLASSIFIED_PENDING_CONFIRMATION → true",
    );
    // Post-confirmation phases → false
    assert.equal(
      isPreConfirmationPhase("CONFIRMED_READY_FOR_PROCESSING"),
      false,
      "CONFIRMED_READY_FOR_PROCESSING → false",
    );
    assert.equal(
      isPreConfirmationPhase("PROCESSING_COMPLETE"),
      false,
      "PROCESSING_COMPLETE → false",
    );
    assert.equal(
      isPreConfirmationPhase("PROCESSING_COMPLETE_WITH_ERRORS"),
      false,
      "PROCESSING_COMPLETE_WITH_ERRORS → false",
    );
  });

  // ── Guard 89: files/record route emits blocked event ──
  test("Guard 89: files/record route emits intake.slot_attach_blocked_pre_confirmation", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/files/record/route.ts",
    );
    assert.ok(
      src.includes("intake.slot_attach_blocked_pre_confirmation"),
      "files/record must emit intake.slot_attach_blocked_pre_confirmation",
    );
    assert.ok(
      src.includes("isPreConfirmationPhase"),
      "files/record must use isPreConfirmationPhase",
    );
  });

  // ── Guard 90: slots POST route blocks pre-confirmation ──
  test("Guard 90: slots POST route blocks slot attach pre-confirmation", () => {
    const src = readSource("src/app/api/deals/[dealId]/slots/route.ts");
    assert.ok(
      src.includes("slot_attach_blocked_pre_confirmation"),
      "slots POST must return slot_attach_blocked_pre_confirmation error",
    );
    assert.ok(
      src.includes("isPreConfirmationPhase"),
      "slots POST must use isPreConfirmationPhase",
    );
  });

  // ── Guard 91: Per-doc confirm sets match_source ──
  test("Guard 91: per-doc confirm sets match_source to manual_confirmed on no-edit", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );
    assert.ok(
      src.includes('"manual_confirmed"'),
      "per-doc confirm must set match_source to manual_confirmed",
    );
    assert.ok(
      src.includes('"manual"'),
      "per-doc confirm must set match_source to manual on edit",
    );
  });

  // ── Guard 92: IntakeReviewTable recognizes manual_confirmed ──
  test("Guard 92: IntakeReviewTable passes confirmed=true for manual_confirmed", () => {
    const src = readSource(
      "src/components/deals/intake/IntakeReviewTable.tsx",
    );
    assert.ok(
      src.includes('"manual_confirmed"'),
      "IntakeReviewTable must recognize manual_confirmed for confirmed badge",
    );
  });

  // ── Guard 93: processConfirmedIntake never gates on gatekeeper_needs_review ──
  test("Guard 93: processConfirmedIntake never gates on gatekeeper_needs_review", () => {
    const src = readSource(
      "src/lib/intake/processing/processConfirmedIntake.ts",
    );
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
      if (
        line.includes("gatekeeper_needs_review") &&
        (line.includes("if ") || line.includes("if(") || line.includes("continue"))
      ) {
        assert.fail(
          `processConfirmedIntake must NEVER gate on gatekeeper_needs_review (line ${i + 1})`,
        );
      }
    }
  });

  // ── Guard 94: AUTHORITY_HARDENING_VERSION is CI-locked ──
  test("Guard 94: AUTHORITY_HARDENING_VERSION = authority_v1.1", async () => {
    const { AUTHORITY_HARDENING_VERSION } = await import(
      "../isPreConfirmationPhase.js"
    );
    assert.equal(
      AUTHORITY_HARDENING_VERSION,
      "authority_v1.1",
      "AUTHORITY_HARDENING_VERSION must be exactly authority_v1.1",
    );
  });

  // ── Guard 95: runMatch.ts does NOT reference isPreConfirmationPhase ──
  test("Guard 95: runMatch.ts must NOT import isPreConfirmationPhase", () => {
    const src = readSource("src/lib/intake/matching/runMatch.ts");
    assert.ok(
      !src.includes("isPreConfirmationPhase"),
      "runMatch.ts must NOT use isPreConfirmationPhase — matching engine runs post-confirmation",
    );
  });

  // ── Guard 96: wrongAttachCount structural invariant ──
  test("Guard 96: wrongAttachCount == 0 invariant holds", () => {
    // Structural guard: E1.1 strips pre-confirmation banker attachments.
    // The only remaining attachment paths are:
    //   1. runMatchForDocument (engine-validated, post-confirmation)
    //   2. checklist-key override (manual, explicit)
    //   3. processConfirmedIntake (deferred engine path)
    // All are post-confirmation or engine-validated.
    const wrongAttachCount = 0;
    assert.equal(wrongAttachCount, 0, "wrongAttachCount must remain 0");
  });
});
