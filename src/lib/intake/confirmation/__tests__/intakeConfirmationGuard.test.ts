/**
 * Phase E0 + E1 — Intake Confirmation Gate CI Guards
 *
 * Guards 1-10: E0 confirmation gate structural integrity
 * Guards 11-17: E1 snapshot enforcement & processing boundary lock
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CONFIDENCE_THRESHOLDS,
  INTAKE_CONFIRMATION_VERSION,
  INTAKE_SNAPSHOT_VERSION,
  confidenceBand,
  deriveIntakeStatus,
  computeIntakeSnapshotHash,
} from "../types";

// ── Helpers ────────────────────────────────────────────────────────────

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ── Guard 1: processArtifact references isIntakeConfirmationGateEnabled ──

test("[guard-1] processArtifact references isIntakeConfirmationGateEnabled", () => {
  const src = readSource("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    src.includes("isIntakeConfirmationGateEnabled"),
    "processArtifact.ts must reference isIntakeConfirmationGateEnabled",
  );
});

// ── Guard 2: processArtifact is fail-closed (no fail-open) ──────────

test("[guard-2] processArtifact does NOT contain fail-open", () => {
  const src = readSource("src/lib/artifacts/processArtifact.ts");

  // The gate checkpoint must be fail-closed — catch block emits error and returns
  assert.ok(
    src.includes("intake.gate_error_detected"),
    "processArtifact.ts must emit intake.gate_error_detected on gate error (fail-closed)",
  );

  // Must NOT have "fail-open" or "failOpen" as a behavioral pattern
  const failOpenRe = /\bfail.?open\b/i;
  const gateSection = src.slice(
    src.indexOf("isIntakeConfirmationGateEnabled"),
    src.indexOf("isIntakeConfirmationGateEnabled") + 3000,
  );
  assert.ok(
    !failOpenRe.test(gateSection),
    "processArtifact.ts gate section must not contain fail-open semantics",
  );
});

// ── Guard 3: enqueueDealProcessing checks intake_phase ──────────────

test("[guard-3] enqueueDealProcessing checks intake_phase before downstream work", () => {
  const src = readSource("src/lib/intake/processing/enqueueDealProcessing.ts");
  assert.ok(
    src.includes("intake_phase"),
    "enqueueDealProcessing must check intake_phase",
  );
  assert.ok(
    src.includes("CONFIRMED_READY_FOR_PROCESSING"),
    "enqueueDealProcessing must reference CONFIRMED_READY_FOR_PROCESSING",
  );
  assert.ok(
    src.includes("FAIL-CLOSED"),
    "enqueueDealProcessing must document fail-closed behavior",
  );
});

// ── Guard 4: Confirm route rejects when pending/uploaded docs exist ──

test("[guard-4] confirm route rejects when pending/uploaded docs exist", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("UPLOADED"),
    "confirm route must check for UPLOADED status",
  );
  assert.ok(
    src.includes("CLASSIFIED_PENDING_REVIEW"),
    "confirm route must check for CLASSIFIED_PENDING_REVIEW status",
  );
  assert.ok(
    src.includes("pending_documents_exist"),
    "confirm route must reject with pending_documents_exist error",
  );
});

// ── Guard 5: Correction endpoint emits intake.document_corrected ────

test("[guard-5] correction endpoint emits intake.document_corrected", () => {
  const src = readSource(
    "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
  );
  assert.ok(
    src.includes("intake.document_corrected"),
    "correction endpoint must emit intake.document_corrected event",
  );
  assert.ok(
    src.includes("intake.document_confirmed"),
    "correction endpoint must emit intake.document_confirmed event (no-change case)",
  );
});

// ── Guard 6: Snapshot hash required at confirmation ─────────────────

test("[guard-6] snapshot hash computed when phase = CONFIRMED_READY_FOR_PROCESSING", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("computeIntakeSnapshotHash"),
    "confirm route must compute intake_snapshot_hash",
  );
  assert.ok(
    src.includes("intake_snapshot_hash"),
    "confirm route must store intake_snapshot_hash on deals",
  );
});

// ── Guard 7: CONFIDENCE_THRESHOLDS CI-locked ────────────────────────

test("[guard-7] CONFIDENCE_THRESHOLDS are CI-locked (0.75 / 0.90 / 0.90)", () => {
  assert.equal(CONFIDENCE_THRESHOLDS.RED_BELOW, 0.75);
  assert.equal(CONFIDENCE_THRESHOLDS.AMBER_BELOW, 0.90);
  assert.equal(CONFIDENCE_THRESHOLDS.GREEN_AT_OR_ABOVE, 0.90);
});

// ── Guard 8: confidenceBand() pure function correctness ─────────────

test("[guard-8] confidenceBand() pure function correctness", () => {
  assert.equal(confidenceBand(null), "red");
  assert.equal(confidenceBand(undefined), "red");
  assert.equal(confidenceBand(0), "red");
  assert.equal(confidenceBand(0.5), "red");
  assert.equal(confidenceBand(0.74), "red");
  assert.equal(confidenceBand(0.75), "amber");
  assert.equal(confidenceBand(0.85), "amber");
  assert.equal(confidenceBand(0.89), "amber");
  assert.equal(confidenceBand(0.90), "green");
  assert.equal(confidenceBand(0.95), "green");
  assert.equal(confidenceBand(1.0), "green");
});

// ── Guard 9: deriveIntakeStatus() pure function correctness ─────────

test("[guard-9] deriveIntakeStatus() pure function correctness", () => {
  assert.equal(deriveIntakeStatus(null), "CLASSIFIED_PENDING_REVIEW");
  assert.equal(deriveIntakeStatus(undefined), "CLASSIFIED_PENDING_REVIEW");
  assert.equal(deriveIntakeStatus(0.5), "CLASSIFIED_PENDING_REVIEW");
  assert.equal(deriveIntakeStatus(0.74), "CLASSIFIED_PENDING_REVIEW");
  assert.equal(deriveIntakeStatus(0.89), "CLASSIFIED_PENDING_REVIEW");
  assert.equal(deriveIntakeStatus(0.90), "AUTO_CONFIRMED");
  assert.equal(deriveIntakeStatus(0.95), "AUTO_CONFIRMED");
  assert.equal(deriveIntakeStatus(1.0), "AUTO_CONFIRMED");
});

// ── Guard 10: computeIntakeSnapshotHash() is deterministic ──────────

test("[guard-10] computeIntakeSnapshotHash() is deterministic", () => {
  const docs = [
    { id: "aaa", canonical_type: "BUSINESS_TAX_RETURN", doc_year: 2024 },
    { id: "bbb", canonical_type: "RENT_ROLL", doc_year: 2023 },
    { id: "ccc", canonical_type: null, doc_year: null },
  ];

  const hash1 = computeIntakeSnapshotHash(docs);
  const hash2 = computeIntakeSnapshotHash(docs);
  assert.equal(hash1, hash2, "Same input must produce same hash");

  // Order independence
  const reversed = [...docs].reverse();
  const hash3 = computeIntakeSnapshotHash(reversed);
  assert.equal(hash1, hash3, "Order must not affect hash (sorted internally)");

  // Different input → different hash
  const modified = [
    { id: "aaa", canonical_type: "PERSONAL_TAX_RETURN", doc_year: 2024 },
    { id: "bbb", canonical_type: "RENT_ROLL", doc_year: 2023 },
    { id: "ccc", canonical_type: null, doc_year: null },
  ];
  const hash4 = computeIntakeSnapshotHash(modified);
  assert.notEqual(hash1, hash4, "Different input must produce different hash");

  // Hash format: SHA-256 hex = 64 chars
  assert.equal(hash1.length, 64, "Hash must be 64-char SHA-256 hex");
  assert.ok(/^[0-9a-f]{64}$/.test(hash1), "Hash must be lowercase hex");

  // Confirmation version is stable
  assert.equal(INTAKE_CONFIRMATION_VERSION, "confirmation_v1");
});

// ═══════════════════════════════════════════════════════════════════════
// Phase E1 — Snapshot Enforcement & Processing Boundary Lock
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 11: INTAKE_SNAPSHOT_VERSION CI-locked ──────────────────────

test("[guard-11] INTAKE_SNAPSHOT_VERSION is CI-locked (snapshot_v1)", () => {
  assert.equal(INTAKE_SNAPSHOT_VERSION, "snapshot_v1");
});

// ── Guard 12: processConfirmedIntake verifies snapshot hash ──────────

test("[guard-12] processConfirmedIntake contains computeIntakeSnapshotHash (verification at execution root)", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("computeIntakeSnapshotHash"),
    "processConfirmedIntake.ts must call computeIntakeSnapshotHash for verification",
  );
  assert.ok(
    src.includes("intake_snapshot_hash"),
    "processConfirmedIntake.ts must read stored intake_snapshot_hash",
  );
});

// ── Guard 13: processConfirmedIntake emits snapshot_mismatch_detected ─

test("[guard-13] processConfirmedIntake emits intake.snapshot_mismatch_detected", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("intake.snapshot_mismatch_detected"),
    "processConfirmedIntake.ts must emit intake.snapshot_mismatch_detected on hash mismatch",
  );
  assert.ok(
    src.includes("intake.snapshot_hash_missing"),
    "processConfirmedIntake.ts must emit intake.snapshot_hash_missing when hash is null",
  );
});

// ── Guard 14: Correction endpoint has LOCKED_FOR_PROCESSING guard ────

test("[guard-14] correction endpoint blocks LOCKED_FOR_PROCESSING documents", () => {
  const src = readSource(
    "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
  );
  assert.ok(
    src.includes("LOCKED_FOR_PROCESSING"),
    "correction endpoint must check for LOCKED_FOR_PROCESSING status",
  );
  assert.ok(
    src.includes("document_locked_for_processing"),
    "correction endpoint must reject with document_locked_for_processing error",
  );
});

// ── Guard 15: invalidateIntakeSnapshot structural integrity ──────────

test("[guard-15] invalidateIntakeSnapshot is server-only and emits correct events", () => {
  const src = readSource(
    "src/lib/intake/confirmation/invalidateIntakeSnapshot.ts",
  );
  assert.ok(
    src.includes('import "server-only"'),
    "invalidateIntakeSnapshot.ts must be server-only",
  );
  assert.ok(
    src.includes("intake.snapshot_invalidated_new_upload"),
    "invalidateIntakeSnapshot.ts must emit intake.snapshot_invalidated_new_upload",
  );
  assert.ok(
    src.includes("CLASSIFIED_PENDING_CONFIRMATION"),
    "invalidateIntakeSnapshot.ts must reset to CLASSIFIED_PENDING_CONFIRMATION",
  );
});

// ── Guard 16: Banker upload route references invalidateIntakeSnapshot ─

test("[guard-16] banker upload route calls invalidateIntakeSnapshot", () => {
  const src = readSource("src/app/api/deals/[dealId]/files/record/route.ts");
  assert.ok(
    src.includes("invalidateIntakeSnapshot"),
    "banker upload route must reference invalidateIntakeSnapshot",
  );
});

// ── Guard 17: Confirm route stores intake_snapshot_version ───────────

test("[guard-17] confirm route stores intake_snapshot_version via INTAKE_SNAPSHOT_VERSION", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("INTAKE_SNAPSHOT_VERSION"),
    "confirm route must import and use INTAKE_SNAPSHOT_VERSION",
  );
  assert.ok(
    src.includes("intake_snapshot_version"),
    "confirm route must store intake_snapshot_version on deals",
  );
});
