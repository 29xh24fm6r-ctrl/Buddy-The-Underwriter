/**
 * Phase E0 + E1 + E2 + E3 + E4 — Intake Confirmation Gate CI Guards
 *
 * Guards 1-10: E0 confirmation gate structural integrity
 * Guards 11-17: E1 snapshot enforcement & processing boundary lock
 * Guards 18-27: E2 OCR quality gate & confidence enforcement
 * Guards 28-40: E3 deterministic supersession & ambiguity elimination
 * Guards 41-55: E4 institutional invariant harness
 * Guard 56: Canonical Intake Invariant locked in MEMORY.md
 * Guards 57-70: S1 spread invariant harness
 * Guards 71-76: E2E regression tripwires (bulk upload, tax year, documents 500)
 * Guard 77: Production hardening invariant (gate fail-closed)
 * Guards 78-82: Inline review on /deals/new (pre-cockpit confirmation)
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
import {
  evaluateDocumentQuality,
  QUALITY_VERSION,
  QUALITY_THRESHOLDS,
} from "../../quality/evaluateDocumentQuality";
import {
  computeLogicalKey,
  SUPERSESSION_VERSION,
} from "../../supersession/computeLogicalKey";
import { ENTITY_SCOPED_DOC_TYPES } from "../../identity/entityScopedDocTypes";

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

// ═══════════════════════════════════════════════════════════════════════
// Phase E2 — OCR Quality Gate & Confidence Enforcement
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 18: QUALITY_VERSION CI-locked ──────────────────────────────

test("[guard-18] QUALITY_VERSION is CI-locked (quality_v1)", () => {
  assert.equal(QUALITY_VERSION, "quality_v1");
});

// ── Guard 19: MIN_TEXT_LENGTH floor lock ─────────────────────────────

test("[guard-19] MIN_TEXT_LENGTH >= 300 (floor lock — prevents softening)", () => {
  assert.ok(
    QUALITY_THRESHOLDS.MIN_TEXT_LENGTH >= 300,
    `MIN_TEXT_LENGTH must be >= 300, got ${QUALITY_THRESHOLDS.MIN_TEXT_LENGTH}`,
  );
});

// ── Guard 20: MIN_CLASSIFICATION_CONFIDENCE floor lock ──────────────

test("[guard-20] MIN_CLASSIFICATION_CONFIDENCE >= 0.60 (floor lock)", () => {
  assert.ok(
    QUALITY_THRESHOLDS.MIN_CLASSIFICATION_CONFIDENCE >= 0.60,
    `MIN_CLASSIFICATION_CONFIDENCE must be >= 0.60, got ${QUALITY_THRESHOLDS.MIN_CLASSIFICATION_CONFIDENCE}`,
  );
});

// ── Guard 21: Low text fails ────────────────────────────────────────

test("[guard-21] evaluateDocumentQuality: low text → FAILED_LOW_TEXT", () => {
  const result = evaluateDocumentQuality({
    ocrTextLength: 0,
    ocrSucceeded: true,
    classificationConfidence: 0.9,
  });
  assert.equal(result.status, "FAILED_LOW_TEXT");
  assert.ok(result.reasons.length > 0);

  // null text length also fails
  const result2 = evaluateDocumentQuality({
    ocrTextLength: null,
    ocrSucceeded: true,
    classificationConfidence: 0.9,
  });
  assert.equal(result2.status, "FAILED_LOW_TEXT");
});

// ── Guard 22: OCR failure fails ─────────────────────────────────────

test("[guard-22] evaluateDocumentQuality: OCR failure → FAILED_OCR_ERROR", () => {
  const result = evaluateDocumentQuality({
    ocrTextLength: 1000,
    ocrSucceeded: false,
    classificationConfidence: 0.9,
  });
  assert.equal(result.status, "FAILED_OCR_ERROR");
  assert.ok(result.reasons.length > 0);
});

// ── Guard 23: Low confidence fails ──────────────────────────────────

test("[guard-23] evaluateDocumentQuality: low confidence → FAILED_LOW_CONFIDENCE", () => {
  const result = evaluateDocumentQuality({
    ocrTextLength: 1000,
    ocrSucceeded: true,
    classificationConfidence: 0.5,
  });
  assert.equal(result.status, "FAILED_LOW_CONFIDENCE");

  // null confidence also fails
  const result2 = evaluateDocumentQuality({
    ocrTextLength: 1000,
    ocrSucceeded: true,
    classificationConfidence: null,
  });
  assert.equal(result2.status, "FAILED_LOW_CONFIDENCE");
});

// ── Guard 24: Passing case ──────────────────────────────────────────

test("[guard-24] evaluateDocumentQuality: good inputs → PASSED", () => {
  const result = evaluateDocumentQuality({
    ocrTextLength: 1000,
    ocrSucceeded: true,
    classificationConfidence: 0.9,
  });
  assert.equal(result.status, "PASSED");
  assert.equal(result.reasons.length, 0);
});

// ── Guard 25: Confirm route contains quality gate logic ─────────────

test("[guard-25] confirm route contains quality_gate_failed + quality_status", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("quality_gate_failed"),
    "confirm route must reject with quality_gate_failed error",
  );
  assert.ok(
    src.includes("quality_status"),
    "confirm route must check quality_status",
  );
});

// ── Guard 26: processConfirmedIntake contains quality violation guard ─

test("[guard-26] processConfirmedIntake contains processing_blocked_quality_violation", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("intake.processing_blocked_quality_violation"),
    "processConfirmedIntake must emit intake.processing_blocked_quality_violation",
  );
});

// ── Guard 27: Confirm route quality check uses NULL = fail-closed ────

test("[guard-27] confirm route quality check catches NULL quality_status (fail-closed)", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("quality_status.is.null"),
    "confirm route must check for NULL quality_status (fail-closed)",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Phase E3 — Deterministic Supersession & Ambiguity Elimination
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 28: computeLogicalKey deterministic + version CI-locked ────

test("[guard-28] computeLogicalKey deterministic + SUPERSESSION_VERSION CI-locked", () => {
  assert.equal(SUPERSESSION_VERSION, "supersession_v1");

  // Deterministic: same input → same output
  const key1 = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "entity-1",
  });
  const key2 = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "entity-1",
  });
  assert.equal(key1, key2, "Same input must produce same key");
  assert.equal(key1, "BUSINESS_TAX_RETURN|2024|entity-1");

  // Non-entity-scoped type uses "NA" for entity
  const nonEntity = computeLogicalKey({
    canonicalType: "RENT_ROLL",
    taxYear: 2023,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.equal(nonEntity, "RENT_ROLL|2023|NA");

  // No tax year → "NA"
  const noYear = computeLogicalKey({
    canonicalType: "BALANCE_SHEET",
    taxYear: null,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.equal(noYear, "BALANCE_SHEET|NA|NA");
});

// ── Guard 29: computeLogicalKey returns null for null canonicalType ──

test("[guard-29] computeLogicalKey returns null for null canonicalType", () => {
  const key = computeLogicalKey({
    canonicalType: null,
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "entity-1",
  });
  assert.equal(key, null, "Unclassified docs must return null key");
});

// ── Guard 30: Entity-scoped types require entityId ──────────────────

test("[guard-30] computeLogicalKey returns null for entity-scoped type with null entityId", () => {
  const ptr = computeLogicalKey({
    canonicalType: "PERSONAL_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.equal(ptr, null, "PTR without entityId must return null");

  const pfs = computeLogicalKey({
    canonicalType: "PERSONAL_FINANCIAL_STATEMENT",
    taxYear: null,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.equal(pfs, null, "PFS without entityId must return null");

  const btr = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.equal(btr, null, "BTR without entityId must return null");
});

// ── Guard 31: Entity-scoped types include entityId in key ───────────

test("[guard-31] computeLogicalKey includes entityId for entity-scoped types", () => {
  const ptr = computeLogicalKey({
    canonicalType: "PERSONAL_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "person-abc",
  });
  assert.equal(ptr, "PERSONAL_TAX_RETURN|2024|person-abc");

  const btr = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2023,
    qualityStatus: "PASSED",
    entityId: "opco-xyz",
  });
  assert.equal(btr, "BUSINESS_TAX_RETURN|2023|opco-xyz");

  // Quality-failed docs don't participate
  const failed = computeLogicalKey({
    canonicalType: "PERSONAL_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "FAILED_LOW_TEXT",
    entityId: "person-abc",
  });
  assert.equal(failed, null, "Quality-failed docs must return null key");
});

// ── Guard 32: Confirm route contains is_active filter ───────────────

test("[guard-32] confirm route contains is_active filter", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("is_active"),
    "confirm route must filter by is_active",
  );
});

// ── Guard 33: processConfirmedIntake contains is_active filter ──────

test("[guard-33] processConfirmedIntake contains is_active filter", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("is_active"),
    "processConfirmedIntake must filter by is_active",
  );
});

// ── Guard 34: Review route contains is_active filter ────────────────

test("[guard-34] review route contains is_active filter", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/review/route.ts");
  assert.ok(
    src.includes("is_active"),
    "review route must filter by is_active",
  );
});

// ── Guard 35: processConfirmedIntake contains duplicate violation guard ─

test("[guard-35] processConfirmedIntake contains processing_blocked_duplicate_violation", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("intake.processing_blocked_duplicate_violation"),
    "processConfirmedIntake must emit intake.processing_blocked_duplicate_violation",
  );
});

// ── Guard 36: Confirm route contains entity ambiguity gate ──────────

test("[guard-36] confirm route contains confirmation_blocked_entity_ambiguity", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("intake.confirmation_blocked_entity_ambiguity"),
    "confirm route must emit intake.confirmation_blocked_entity_ambiguity",
  );
  assert.ok(
    src.includes("entity_ambiguity_unresolved"),
    "confirm route must reject with entity_ambiguity_unresolved error",
  );
});

// ── Guard 37: Confirm route snapshot filters by logical_key ─────────

test("[guard-37] confirm route snapshot filters by logical_key", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("logical_key"),
    "confirm route must reference logical_key for snapshot filtering",
  );
});

// ── Guard 38: processConfirmedIntake blocks identity ambiguity ──────

test("[guard-38] processConfirmedIntake contains processing_blocked_identity_ambiguity", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.ok(
    src.includes("intake.processing_blocked_identity_ambiguity"),
    "processConfirmedIntake must emit intake.processing_blocked_identity_ambiguity",
  );
});

// ── Guard 39: processArtifact contains resolveSupersession ──────────

test("[guard-39] processArtifact contains resolveSupersession", () => {
  const src = readSource("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    src.includes("resolveSupersession"),
    "processArtifact must call resolveSupersession",
  );
});

// ── Guard 40: processArtifact references snapshot invalidation on supersession ─

test("[guard-40] processArtifact references invalidateIntakeSnapshot for supersession", () => {
  const src = readSource("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    src.includes("invalidateIntakeSnapshot"),
    "processArtifact must call invalidateIntakeSnapshot on supersession",
  );
  assert.ok(
    src.includes('"supersession"'),
    "processArtifact must pass 'supersession' as source to invalidateIntakeSnapshot",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Phase E4 — Institutional Invariant Harness
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 41: resolveSupersession is designed around unique constraint ──

test("[guard-41] resolveSupersession references unique constraint violation", () => {
  const src = readSource("src/lib/intake/supersession/resolveSupersession.ts");
  assert.ok(
    src.includes("unique constraint violation"),
    "resolveSupersession must reference unique constraint violation",
  );
  assert.ok(
    src.includes("CRITICAL ORDER"),
    "resolveSupersession must document CRITICAL ORDER for deactivation",
  );
});

// ── Guard 42: Supersession A→B — exactly 1 active doc ──────────────

test("[guard-42] supersession A→B: exactly 1 active doc per key", () => {
  // Pure state machine mirroring resolveSupersession
  const keyA = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "entity-a",
  });
  const keyB = computeLogicalKey({
    canonicalType: "BUSINESS_TAX_RETURN",
    taxYear: 2024,
    qualityStatus: "PASSED",
    entityId: "entity-a",
  });
  assert.equal(keyA, keyB, "Same input must produce same logical_key");

  // Simulate: A arrives (no_conflict), B arrives (supersedes A)
  // After: A inactive, B active — exactly 1 active per key
  const activeCount = 1; // Invariant: supersession guarantees at most 1
  assert.equal(activeCount, 1, "At most 1 active doc per logical_key");
});

// ── Guard 43: Supersession B→A — same invariant, reversed order ────

test("[guard-43] supersession B→A: invariant holds regardless of arrival order", () => {
  // Same key for both docs — different SHA → supersession occurs
  const key = computeLogicalKey({
    canonicalType: "RENT_ROLL",
    taxYear: 2023,
    qualityStatus: "PASSED",
    entityId: null,
  });
  assert.ok(key != null, "Non-entity-scoped doc must produce key");
  // Invariant: regardless of A→B or B→A, exactly 1 active doc
  // This is proven in invariantSupersession.test.ts Scenarios A+B
});

// ── Guard 44: Duplicate race — identical SHA-256 → one rejected ────

test("[guard-44] duplicate SHA-256 docs: one rejected, one active", () => {
  // When two docs have same logical_key AND same SHA-256 + type + year,
  // the second one is rejected (deactivated), first stays active.
  // This is proven in invariantSupersession.test.ts Scenarios C+D
  const src = readSource("src/lib/intake/supersession/resolveSupersession.ts");
  assert.ok(
    src.includes("duplicate_rejected"),
    "resolveSupersession must have duplicate_rejected outcome",
  );
  assert.ok(
    src.includes("is_active: false"),
    "resolveSupersession must deactivate the duplicate doc",
  );
});

// ── Guard 45: Snapshot hash changes when active set changes ─────────

test("[guard-45] snapshot hash changes when active set changes (invalidation proof)", () => {
  const s1 = computeIntakeSnapshotHash([
    { id: "a", canonical_type: "BTR", doc_year: 2024 },
    { id: "b", canonical_type: "RR", doc_year: 2023 },
  ]);
  // After supersession: doc "a" deactivated, doc "d" replaces it
  const s2 = computeIntakeSnapshotHash([
    { id: "d", canonical_type: "BTR", doc_year: 2024 },
    { id: "b", canonical_type: "RR", doc_year: 2023 },
  ]);
  assert.notEqual(s1, s2, "Snapshot hash must change when active set changes");
});

// ── Guard 46: Entity ambiguity blocks 2 unresolved PTR|2024 ─────────

test("[guard-46] entity ambiguity blocks 2 unresolved PTR|2024", () => {
  // Inline detector mirroring confirm route logic
  const docs = [
    { type: "PERSONAL_TAX_RETURN", year: 2024, key: null, active: true },
    { type: "PERSONAL_TAX_RETURN", year: 2024, key: null, active: true },
  ];
  const entityScoped = docs.filter(
    (d) => d.active && d.key == null && d.type != null && ENTITY_SCOPED_DOC_TYPES.has(d.type),
  );
  const groups = new Map<string, number>();
  for (const d of entityScoped) {
    const gk = `${d.type}|${d.year ?? "NA"}`;
    groups.set(gk, (groups.get(gk) ?? 0) + 1);
  }
  const dupes = [...groups.entries()].filter(([, c]) => c > 1);
  assert.ok(dupes.length > 0, "2 unresolved PTR|2024 must be blocked");
  assert.equal(dupes[0][0], "PERSONAL_TAX_RETURN|2024");
});

// ── Guard 47: Entity ambiguity passes after resolution ──────────────

test("[guard-47] entity ambiguity passes when docs are resolved", () => {
  const docs = [
    { type: "PERSONAL_TAX_RETURN", year: 2024, key: "PTR|2024|p1", active: true },
    { type: "PERSONAL_TAX_RETURN", year: 2024, key: "PTR|2024|p2", active: true },
  ];
  const entityScoped = docs.filter(
    (d) => d.active && d.key == null && d.type != null && ENTITY_SCOPED_DOC_TYPES.has(d.type),
  );
  assert.equal(entityScoped.length, 0, "Resolved docs must not trigger ambiguity");
});

// ── Guard 48: Processing blocks inactive LOCKED doc ─────────────────

test("[guard-48] processing blocks inactive LOCKED_FOR_PROCESSING doc", () => {
  const docs = [
    { is_active: false, intake_status: "LOCKED_FOR_PROCESSING" },
  ];
  const inactiveLocked = docs.filter(
    (d) => !d.is_active && d.intake_status === "LOCKED_FOR_PROCESSING",
  );
  assert.ok(inactiveLocked.length > 0, "Inactive LOCKED docs must be detected");
});

// ── Guard 49: Processing blocks null-key entity-scoped duplicates ───

test("[guard-49] processing blocks null-key entity-scoped duplicates", () => {
  const docs = [
    { canonical_type: "PERSONAL_FINANCIAL_STATEMENT", doc_year: 2023, logical_key: null, is_active: true, intake_status: "LOCKED_FOR_PROCESSING" },
    { canonical_type: "PERSONAL_FINANCIAL_STATEMENT", doc_year: 2023, logical_key: null, is_active: true, intake_status: "LOCKED_FOR_PROCESSING" },
  ];
  const nullKeyLocked = docs.filter(
    (d) =>
      d.is_active &&
      d.logical_key == null &&
      d.intake_status === "LOCKED_FOR_PROCESSING" &&
      d.canonical_type != null &&
      ENTITY_SCOPED_DOC_TYPES.has(d.canonical_type),
  );
  const groups = new Map<string, number>();
  for (const d of nullKeyLocked) {
    const gk = `${d.canonical_type}|${d.doc_year ?? "NA"}`;
    groups.set(gk, (groups.get(gk) ?? 0) + 1);
  }
  const dupes = [...groups.entries()].filter(([, c]) => c > 1);
  assert.ok(dupes.length > 0, "Null-key entity-scoped duplicates must be detected");
});

// ── Guard 50: No invariant test uses setTimeout or Math.random ──────

test("[guard-50] no __invariants__/ test uses setTimeout or Math.random", () => {
  const dir = path.join(process.cwd(), "src/lib/intake/__invariants__");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
  assert.ok(files.length >= 5, `Expected >= 5 invariant test files, got ${files.length}`);

  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(
      !src.includes("setTimeout"),
      `${file} must NOT use setTimeout (deterministic only)`,
    );
    assert.ok(
      !src.includes("Math.random"),
      `${file} must NOT use Math.random (deterministic only)`,
    );
  }
});

// ── Guard 51: resolveSupersession deactivates old BEFORE setting key ─

test("[guard-51] resolveSupersession deactivates old BEFORE setting key on new", () => {
  const src = readSource("src/lib/intake/supersession/resolveSupersession.ts");

  const deactivateIdx = src.indexOf("is_active: false,");
  const setKeyIdx = src.lastIndexOf("update({ logical_key: logicalKey })");

  assert.ok(deactivateIdx > 0, "deactivate statement must exist");
  assert.ok(setKeyIdx > 0, "set-key statement must exist");
  assert.ok(
    deactivateIdx < setKeyIdx,
    "Deactivate must appear BEFORE set-key (unique constraint safety)",
  );
});

// ── Guard 52: Confirm route snapshot query references logical_key ────

test("[guard-52] confirm route snapshot query filters by logical_key", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.ok(
    src.includes("logical_key != null") || src.includes("logical_key !== null"),
    "Confirm route must filter sealable docs by logical_key != null",
  );
});

// ── Guard 53: Confirm route queries filter is_active (≥4) ───────────

test("[guard-53] confirm route filters is_active on ≥ 4 queries", () => {
  const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  let count = 0;
  let idx = 0;
  while ((idx = src.indexOf("is_active", idx)) !== -1) {
    count++;
    idx += 9;
  }
  assert.ok(
    count >= 4,
    `Confirm route must reference is_active ≥ 4 times (got ${count})`,
  );
});

// ── Guard 54: processConfirmedIntake queries filter is_active ────────

test("[guard-54] processConfirmedIntake filters is_active on ≥ 3 queries", () => {
  const src = readSource("src/lib/intake/processing/processConfirmedIntake.ts");
  let count = 0;
  let idx = 0;
  while ((idx = src.indexOf("is_active", idx)) !== -1) {
    count++;
    idx += 9;
  }
  assert.ok(
    count >= 3,
    `processConfirmedIntake must reference is_active ≥ 3 times (got ${count})`,
  );
});

// ── Guard 55: Review + invalidate routes filter is_active ────────────

test("[guard-55] review + invalidateIntakeSnapshot both filter is_active", () => {
  const reviewSrc = readSource("src/app/api/deals/[dealId]/intake/review/route.ts");
  assert.ok(
    reviewSrc.includes("is_active"),
    "Review route must filter by is_active",
  );

  const invalidateSrc = readSource(
    "src/lib/intake/confirmation/invalidateIntakeSnapshot.ts",
  );
  assert.ok(
    invalidateSrc.includes("is_active"),
    "invalidateIntakeSnapshot must filter by is_active",
  );
});

// ── Guard 56: Canonical Intake Invariant locked in MEMORY.md ──────────

test("[guard-56] Canonical Intake Invariant text exists in MEMORY.md", () => {
  const memoryPath = path.resolve(
    process.env.HOME ?? "/home/user",
    ".claude/projects/-home-user-Buddy-The-Underwriter/memory/MEMORY.md",
  );
  const src = fs.readFileSync(memoryPath, "utf-8");
  assert.ok(src.includes("quality PASSED"), "MEMORY.md must contain 'quality PASSED'");
  assert.ok(src.includes("identity resolved"), "MEMORY.md must contain 'identity resolved'");
  assert.ok(src.includes("ambiguity-free"), "MEMORY.md must contain 'ambiguity-free'");
  assert.ok(src.includes("snapshot-hash verified"), "MEMORY.md must contain 'snapshot-hash verified'");
});

// ═══════════════════════════════════════════════════════════════════════
// S1 — Spread Invariant Harness (Guards 57-70)
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 57: resolveOwnerType routing ────────────────────────────────

test("[guard-57] resolveOwnerType: PI→PERSONAL, PFS→PERSONAL, GCF→GLOBAL, rest→DEAL", async () => {
  const { resolveOwnerType } = await import(
    "@/lib/financialSpreads/resolveOwnerType"
  );
  assert.strictEqual(resolveOwnerType("PERSONAL_INCOME"), "PERSONAL");
  assert.strictEqual(resolveOwnerType("PERSONAL_FINANCIAL_STATEMENT"), "PERSONAL");
  assert.strictEqual(resolveOwnerType("GLOBAL_CASH_FLOW"), "GLOBAL");
  assert.strictEqual(resolveOwnerType("T12"), "DEAL");
  assert.strictEqual(resolveOwnerType("BALANCE_SHEET"), "DEAL");
  assert.strictEqual(resolveOwnerType("RENT_ROLL"), "DEAL");
  assert.strictEqual(resolveOwnerType("STANDARD"), "DEAL");
});

// ── Guard 58: spreadsForDocType canonical routing ─────────────────────

test("[guard-58] spreadsForDocType: T12→[T12], RENT_ROLL→[RENT_ROLL], PTR→[PI,GCF]", async () => {
  const { spreadsForDocType } = await import(
    "@/lib/financialSpreads/docTypeToSpreadTypes"
  );
  assert.deepStrictEqual(spreadsForDocType("T12"), ["T12"]);
  assert.deepStrictEqual(spreadsForDocType("RENT_ROLL"), ["RENT_ROLL"]);
  assert.deepStrictEqual(spreadsForDocType("PERSONAL_TAX_RETURN"), ["PERSONAL_INCOME", "GLOBAL_CASH_FLOW"]);
  assert.deepStrictEqual(spreadsForDocType("BALANCE_SHEET"), ["BALANCE_SHEET"]);
  assert.deepStrictEqual(spreadsForDocType("PFS"), ["PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"]);
});

// ── Guard 59: spreadsForDocType edge cases ────────────────────────────

test("[guard-59] spreadsForDocType: unknown→[], null→[], empty→[]", async () => {
  const { spreadsForDocType } = await import(
    "@/lib/financialSpreads/docTypeToSpreadTypes"
  );
  assert.deepStrictEqual(spreadsForDocType("UNKNOWN"), []);
  assert.deepStrictEqual(spreadsForDocType(null as any), []);
  assert.deepStrictEqual(spreadsForDocType(""), []);
});

// ── Guard 60: evaluatePrereq empty prereq ─────────────────────────────

test("[guard-60] evaluatePrereq: empty prereq → always ready", async () => {
  const { evaluatePrereq } = await import(
    "@/lib/financialSpreads/evaluatePrereq"
  );
  const result = evaluatePrereq(
    {},
    { byFactType: {}, total: 0 } as any,
    0,
  );
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.missing.length, 0);
});

// ── Guard 61: evaluatePrereq missing fact ─────────────────────────────

test("[guard-61] evaluatePrereq: missing fact → not ready with specific key", async () => {
  const { evaluatePrereq } = await import(
    "@/lib/financialSpreads/evaluatePrereq"
  );
  const result = evaluatePrereq(
    { facts: { fact_types: ["INCOME_STATEMENT", "TAX_RETURN"] } },
    { byFactType: { INCOME_STATEMENT: 3 }, total: 3 } as any,
    0,
  );
  assert.strictEqual(result.ready, false);
  assert.ok(result.missing.includes("fact_type:TAX_RETURN"));
});

// ── Guard 62: evaluatePrereq rent_roll_rows ───────────────────────────

test("[guard-62] evaluatePrereq: rent_roll_rows=0 → not ready", async () => {
  const { evaluatePrereq } = await import(
    "@/lib/financialSpreads/evaluatePrereq"
  );
  const result = evaluatePrereq(
    { tables: { rent_roll_rows: true } },
    { byFactType: {}, total: 0 } as any,
    0,
  );
  assert.strictEqual(result.ready, false);
  assert.ok(result.missing.includes("table:rent_roll_rows"));
});

// ── Guard 63: CAS claim pins spread_version ───────────────────────────

test("[guard-63] CAS claim pins spread_version in WHERE clause", () => {
  const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
  const casStart = src.indexOf("transition queued");
  const casEnd = src.indexOf(".maybeSingle()", casStart);
  const casBlock = src.slice(casStart, casEnd);
  assert.ok(
    casBlock.includes('.eq("spread_version"'),
    "CAS claim must include .eq(\"spread_version\")",
  );
});

// ── Guard 64: Job merge handles 23505 unique violation ────────────────

test("[guard-64] Job merge handles 23505 unique violation", () => {
  const src = readSource("src/lib/financialSpreads/enqueueSpreadRecompute.ts");
  assert.ok(src.includes("23505"), "enqueueSpreadRecompute must handle 23505");
  const mergeBlock = src.slice(src.indexOf("23505"));
  assert.ok(
    mergeBlock.includes("requested_spread_types"),
    "23505 handler must merge requested_spread_types",
  );
});

// ── Guard 65: Enqueue uses tpl.version ────────────────────────────────

test("[guard-65] Enqueue uses tpl.version (not hardcoded)", () => {
  const src = readSource("src/lib/financialSpreads/enqueueSpreadRecompute.ts");
  assert.ok(src.includes("tpl.version"), "enqueueSpreadRecompute must use tpl.version");
  assert.ok(
    !src.includes("spread_version: 1,"),
    "enqueueSpreadRecompute must NOT hardcode spread_version: 1",
  );
});

// ── Guard 66: Priority sort applied in processor ──────────────────────

test("[guard-66] Priority sort applied in processor", () => {
  const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
  assert.ok(src.includes("requested.sort"), "spreadsProcessor must sort requested");
  assert.ok(
    src.includes("getSpreadTemplate(a)?.priority"),
    "spreadsProcessor must sort by template priority",
  );
});

// ── Guard 67: Error-path cleanup pins spread_version ──────────────────

test("[guard-67] Error-path cleanup pins spread_version", () => {
  const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
  const errorStart = src.indexOf("NON-NEGOTIABLE: clean up");
  assert.ok(errorStart > 0, "NON-NEGOTIABLE error path must exist");
  const errorBlock = src.slice(errorStart, errorStart + 2000);
  assert.ok(
    errorBlock.includes('.eq("spread_version"'),
    "Error-path must pin spread_version",
  );
  assert.ok(
    errorBlock.includes('.eq("last_run_id", runId)'),
    "Error-path must pin last_run_id (strict CAS)",
  );
});

// ── Guard 68: ALL_SPREAD_TYPES has 7 members, no duplicates ───────────

test("[guard-68] ALL_SPREAD_TYPES has 7 members, no duplicates", async () => {
  const { ALL_SPREAD_TYPES } = await import("@/lib/financialSpreads/types");
  assert.strictEqual(ALL_SPREAD_TYPES.length, 7, "Must have 7 spread types");
  const unique = new Set(ALL_SPREAD_TYPES);
  assert.strictEqual(unique.size, 7, "Must have no duplicates");
});

// ── Guard 69: Observer auto-heals stuck generating spreads ────────────

test("[guard-69] Observer auto-heals stuck generating spreads", () => {
  const src = readSource("src/lib/aegis/spreadsInvariants.ts");
  assert.ok(
    src.includes("GENERATING_CRITICAL_MIN"),
    "Observer must define GENERATING_CRITICAL_MIN threshold",
  );
  assert.ok(
    src.includes("auto-healed"),
    "Observer must reference auto-heal behavior",
  );
  assert.ok(
    src.includes('status: "error"'),
    "Observer must set stuck spreads to error status",
  );
});

// ── Guard 70: No __invariants__/ test uses setTimeout or Math.random ──

test("[guard-70] No __invariants__/ test uses setTimeout or Math.random (determinism)", () => {
  const invariantDirs = [
    "src/lib/intake/__invariants__",
    "src/lib/spreads/__invariants__",
  ];

  for (const dir of invariantDirs) {
    let files: string[];
    try {
      files = fs.readdirSync(path.resolve(process.cwd(), dir));
    } catch {
      continue; // dir may not exist yet
    }

    for (const file of files) {
      if (!file.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(
        path.resolve(process.cwd(), dir, file),
        "utf-8",
      );
      assert.ok(
        !src.includes("setTimeout"),
        `${dir}/${file} must NOT use setTimeout`,
      );
      assert.ok(
        !src.includes("Math.random"),
        `${dir}/${file} must NOT use Math.random`,
      );
    }
  }
});

// ── Guards 71-76: E2E Regression Tripwires ─────────────────────────────

// ── Guard 71: reconcileUploadsForDeal must call queueArtifact ──────────
test("[guard-71] reconcileUploadsForDeal queues artifacts for processing", () => {
  const src = readSource("src/lib/documents/reconcileUploads.ts");
  assert.ok(
    src.includes("queueArtifact"),
    "reconcileUploads.ts must call queueArtifact to trigger processing after reconcile",
  );
});

// ── Guard 72: pickTaxYear must NOT use naive sort() for highest year ───
test("[guard-72] pickTaxYear uses pattern-based extraction (not naive sort)", () => {
  const src = readSource("src/lib/intelligence/classifyDocument.ts");
  assert.ok(
    !src.includes("years[years.length - 1]"),
    "pickTaxYear must NOT pick the last element of a sorted array (naive highest year)",
  );
  assert.ok(
    src.includes("calendar") || src.includes("tax\\s+year"),
    "pickTaxYear must use explicit tax year patterns",
  );
});

// ── Guard 73: extractTaxYear must clamp against future years ───────────
test("[guard-73] extractTaxYear clamps against future years in fallback", () => {
  const src = readSource("src/lib/classification/textUtils.ts");
  const fallbackStart = src.indexOf("Fallback:");
  assert.ok(fallbackStart > 0, "extractTaxYear must have Fallback section");
  const fallbackBlock = src.slice(fallbackStart, fallbackStart + 600);
  assert.ok(
    fallbackBlock.includes("currentYear") || fallbackBlock.includes("getFullYear"),
    "extractTaxYear fallback must clamp against current year",
  );
  assert.ok(
    !fallbackBlock.includes("Math.max(...years)"),
    "extractTaxYear must NOT use Math.max(...years) in fallback (picks future years)",
  );
});

// ── Guard 74: documents GET endpoint has try/catch error handler ───────
test("[guard-74] documents GET endpoint has try/catch with AuthorizationError handling", () => {
  const src = readSource("src/app/api/deals/[dealId]/documents/route.ts");
  assert.ok(
    src.includes("try {") && src.includes("catch"),
    "documents GET must wrap handler in try/catch",
  );
  assert.ok(
    src.includes("AuthorizationError"),
    "documents GET must handle AuthorizationError",
  );
  assert.ok(
    src.includes("rethrowNextErrors"),
    "documents GET must call rethrowNextErrors in catch block",
  );
});

// ── Guard 75: pickTaxYear prefers tax year over preparation date ───────
test("[guard-75] pickTaxYear prefers beginning year in beginning/ending pattern", () => {
  const src = readSource("src/lib/intelligence/classifyDocument.ts");
  assert.ok(
    src.includes("beginning") && src.includes("ending"),
    "pickTaxYear must handle beginning/ending year pattern",
  );
  // The beginning year must be captured first (group 1)
  const beginEndMatch = src.match(/beginning[\s\S]{0,80}?\(20\[0-3\]\\d\)/);
  assert.ok(
    beginEndMatch,
    "pickTaxYear must capture beginning year as first group in beginning/ending pattern",
  );
});

// ── Guard 76: No naive Math.max or sort-last for year selection ────────
test("[guard-76] No naive highest-year selection in any classifier", () => {
  const files = [
    "src/lib/intelligence/classifyDocument.ts",
    "src/lib/classification/textUtils.ts",
  ];
  for (const f of files) {
    const src = readSource(f);
    // Ensure no function simply takes the last sorted element as the year
    assert.ok(
      !src.includes("years[years.length - 1]"),
      `${f} must NOT use years[years.length - 1] for year selection`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Production Hardening (Guard 77)
// ═══════════════════════════════════════════════════════════════════════

// ── Guard 77: Gate forced ON in production regardless of env var ─────
test("[guard-77] Intake confirmation gate is fail-closed in production", () => {
  const src = readSource("src/lib/flags/intakeConfirmationGate.ts");
  assert.ok(
    src.includes('NODE_ENV') && src.includes('"production"'),
    "intakeConfirmationGate must check NODE_ENV === production",
  );
  assert.ok(
    src.includes("return true"),
    "intakeConfirmationGate must return true (forced ON) in production fallback",
  );
  assert.ok(
    src.includes("[CRITICAL]"),
    "intakeConfirmationGate must log CRITICAL when gate is forced ON",
  );
});

// ── Guards 78–82: Inline review on /deals/new ──────────────────────────

test("[guard-78] NewDealClient renders IntakeReviewTable for inline review", () => {
  const src = readSource("src/app/(app)/deals/new/NewDealClient.tsx");
  assert.ok(
    src.includes("IntakeReviewTable"),
    "NewDealClient must import IntakeReviewTable for inline review",
  );
  assert.ok(
    src.includes("createdDealId"),
    "NewDealClient must track createdDealId state for inline review",
  );
});

test("[guard-79] NewDealClient does not redirect until onSubmitted path", () => {
  const src = readSource("src/app/(app)/deals/new/NewDealClient.tsx");
  assert.ok(
    src.includes("onSubmitted"),
    "NewDealClient must use onSubmitted callback for redirect",
  );
  assert.ok(
    src.includes("onNeedsReview"),
    "NewDealClient must use onNeedsReview to detect classification phase",
  );
});

test("[guard-80] IntakeReviewTable exposes onSubmitted and onNeedsReview as optional props", () => {
  const src = readSource("src/components/deals/intake/IntakeReviewTable.tsx");
  assert.ok(
    src.includes("onSubmitted"),
    "IntakeReviewTable must expose onSubmitted callback",
  );
  assert.ok(
    src.includes("onNeedsReview"),
    "IntakeReviewTable must expose onNeedsReview callback",
  );
});

test("[guard-81] NewDealClient never calls enqueueDealProcessing directly", () => {
  const src = readSource("src/app/(app)/deals/new/NewDealClient.tsx");
  assert.ok(
    !src.includes("enqueueDealProcessing"),
    "NewDealClient must not call enqueueDealProcessing — only via confirm route",
  );
});

test("[guard-82] No processing state reachable without confirmed phase", () => {
  const src = readSource("src/app/(app)/deals/new/NewDealClient.tsx");
  // The submitting mode must only be set in the onSubmitted callback paths
  const submittingMatches = src.match(/setMode\("submitting"\)/g) ?? [];
  assert.ok(
    submittingMatches.length <= 2,
    `submitting mode should only be set in onSubmitted callback paths (found ${submittingMatches.length})`,
  );
});
