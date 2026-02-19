import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ─── Structural tripwires: deterministic slot validation ordering ─────────────
//
// Buddy invariants enforced:
//   1. Gatekeeper is authoritative for tax_year
//   2. Auto-match must complete (await) before validation
//   3. Validation must run AFTER auto-match stamps slot_id
//   4. No fire-and-forget slot writes
//   5. Ledger reflects deterministic transitions
//
// Updated for Matching Engine v1: runMatchForDocument replaces autoMatchByEffectiveType

function readProcessArtifact(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/artifacts/processArtifact.ts"),
    "utf8",
  );
}

// ─── 1. gatekeeper_tax_year in gkCols SELECT ─────────────────────────────────

test("gatekeeper_tax_year appears in gkCols SELECT", () => {
  const src = readProcessArtifact();
  // Must appear in the .select() call for deal_documents gatekeeper columns
  assert.ok(
    src.includes("gatekeeper_tax_year"),
    "processArtifact.ts must include gatekeeper_tax_year in gkCols SELECT",
  );
});

// ─── 2. Auto-match prefers gatekeeper year over AI year ───────────────────────

test("auto-match prefers gkCols?.gatekeeper_tax_year over classification?.taxYear", () => {
  const src = readProcessArtifact();
  const pattern = "gkCols?.gatekeeper_tax_year ?? classification?.taxYear";
  assert.ok(
    src.includes(pattern),
    "Auto-match taxYear must be: gkCols?.gatekeeper_tax_year ?? classification?.taxYear ?? null",
  );
});

// ─── 3. Matching engine is awaited ──────────────────────────────────────────

test("runMatchForDocument is awaited (not fire-and-forget)", () => {
  const src = readProcessArtifact();
  assert.ok(
    src.includes("await runMatchForDocument"),
    "runMatchForDocument must be awaited",
  );
});

// ─── 4. No .then() on runMatchForDocument ─────────────────────────────────

test("no .then() chained on runMatchForDocument", () => {
  const src = readProcessArtifact();
  // Find all occurrences of runMatchForDocument and ensure none are
  // followed by .then( within the same expression
  const idx = src.indexOf("runMatchForDocument(");
  assert.ok(idx > 0, "runMatchForDocument must be called");

  // Scan the next 500 chars after each call for .then(
  const afterCall = src.slice(idx, idx + 500);
  // Only flag .then( that appears before the next semicolon or await
  const toSemicolon = afterCall.split(";")[0];
  assert.ok(
    !toSemicolon.includes(".then("),
    "runMatchForDocument must not use .then() — use await instead",
  );
});

// ─── 5. validateSlotAttachmentIfAny appears AFTER matching engine ───────────

test("validateSlotAttachmentIfAny appears AFTER runMatchForDocument in source", () => {
  const src = readProcessArtifact();

  const matchIdx = src.indexOf("await runMatchForDocument(");
  const validateIdx = src.indexOf("validateSlotAttachmentIfAny(", matchIdx);

  assert.ok(
    matchIdx > 0,
    "await runMatchForDocument must exist in processArtifact.ts",
  );
  assert.ok(
    validateIdx > matchIdx,
    "validateSlotAttachmentIfAny must appear AFTER runMatchForDocument (deterministic ordering)",
  );
});

// ─── 6. Validation uses effectiveDocType (gatekeeper-derived) ─────────────────

test("slot validation uses effectiveDocType, not raw classification.docType", () => {
  const src = readProcessArtifact();

  // Find the validation call that passes classifiedDocType
  const validateIdx = src.indexOf("validateSlotAttachmentIfAny(");
  assert.ok(validateIdx > 0, "validateSlotAttachmentIfAny must be called");

  // Get the block around the validation call (next ~300 chars)
  const validationBlock = src.slice(validateIdx, validateIdx + 300);

  assert.ok(
    validationBlock.includes("classifiedDocType: effectiveDocType"),
    "Validation must use effectiveDocType (gatekeeper-derived), not classification.docType",
  );
});

// ─── 7. Validation uses gatekeeper_tax_year for year ──────────────────────────

test("slot validation references gatekeeper_tax_year for year param", () => {
  const src = readProcessArtifact();

  // The validation block should use gatekeeper_tax_year in its year resolution
  const validateIdx = src.indexOf("validateSlotAttachmentIfAny(");
  assert.ok(validateIdx > 0, "validateSlotAttachmentIfAny must be called");

  // Look in the ~200 chars before the call for the effectiveTaxYear assignment
  const preBlock = src.slice(Math.max(0, validateIdx - 200), validateIdx);
  assert.ok(
    preBlock.includes("gatekeeper_tax_year"),
    "effectiveTaxYear used by validation must reference gatekeeper_tax_year",
  );
});

// ─── 8. Classification authority gate exists ─────────────────────────────────

test("authority gate checks for classification before matching engine", () => {
  const src = readProcessArtifact();
  assert.ok(
    src.includes("hasAnyClassification"),
    "processArtifact.ts must check hasAnyClassification before matching engine",
  );
  assert.ok(
    src.includes("slot.routing.skipped.no_classification") ||
    src.includes("slot.routing.skipped.missing_gatekeeper"),
    "processArtifact.ts must emit skip event when no classification available",
  );
});

// ─── 9. Matching engine imported from correct path ──────────────────────────

test("matching engine imported from @/lib/intake/matching/runMatch", () => {
  const src = readProcessArtifact();
  assert.ok(
    src.includes("@/lib/intake/matching/runMatch"),
    "processArtifact.ts must import from @/lib/intake/matching/runMatch",
  );
});
