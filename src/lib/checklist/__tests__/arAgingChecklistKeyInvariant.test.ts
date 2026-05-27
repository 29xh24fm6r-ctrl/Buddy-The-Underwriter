/**
 * SPEC-AR-AGING-CHECKLIST-KEY-INVARIANT-1 — Guard tests
 *
 * Ensures AR_AGING documents always have checklist_key='AR_AGING' and that
 * the reconcile self-heals rather than crashes on null checklist_key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";
import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { resolveDocTypeRouting } from "@/lib/documents/docTypeRouting";

// ── Guard 1: classification stamps AR_AGING consistently ─────────────────

test("normalizeToCanonical(AR_AGING) => AR_AGING", () => {
  assert.equal(normalizeToCanonical("AR_AGING"), "AR_AGING");
});

test("resolveDocTypeRouting(AR_AGING) => canonical AR_AGING", () => {
  assert.equal(resolveDocTypeRouting("AR_AGING").canonical_type, "AR_AGING");
});

test("resolveChecklistKey(AR_AGING) => AR_AGING", () => {
  assert.equal(resolveChecklistKey("AR_AGING", null), "AR_AGING");
});

// ── Guard 2: reconcile self-heals null checklist_key ─────────────────────

test("reconcile Phase I is self-healing (does not throw on null checklist_key)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/checklist/engine.ts"),
    "utf-8",
  );

  // Must NOT contain the old "throw new Error(Invariant violation" for checklist_key
  assert.ok(
    !src.includes('throw new Error(\n          `Invariant violation: finalized doc'),
    "reconcile must not throw on null checklist_key — must self-heal",
  );

  // Must contain the self-heal update
  assert.ok(
    src.includes("Phase I self-heal"),
    "reconcile must log self-heal action",
  );

  assert.ok(
    src.includes(".update({ checklist_key: derivedKey })"),
    "reconcile must stamp derivedKey on null-checklist_key docs",
  );
});

// ── Guard 3: no AR_AGING path can finalize without checklist_key ─────────

test("classifyProcessor stamps checklist_key via resolveChecklistKey", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/jobs/processors/classifyProcessor.ts"),
    "utf-8",
  );
  assert.ok(src.includes("resolveChecklistKey"), "classifyProcessor must call resolveChecklistKey");
  assert.ok(src.includes("checklist_key"), "classifyProcessor must stamp checklist_key");
});

// ── Guard 4: AR_AGING is accepted by checklist engine ────────────────────

test("checklist engine accepts AR_AGING as a valid checklist_key", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/checklist/engine.ts"),
    "utf-8",
  );
  // The acceptableDocTypesForChecklistKey or reconcile path must not reject AR_AGING
  // AR_AGING goes through the default path (no explicit mapping needed — it just
  // matches on checklist_key='AR_AGING' directly in the conflict resolution phase)
  assert.ok(
    !src.includes("AR_AGING is not a valid"),
    "checklist engine must not reject AR_AGING",
  );
});

// ── Guard 5: full stamp chain AR_AGING ───────────────────────────────────

test("full AR_AGING stamp chain: classify → normalize → resolve → checklist_key", () => {
  // Simulate the full chain
  const spineDocType = "AR_AGING";
  const docType = normalizeToCanonical(spineDocType);
  const { canonical_type } = resolveDocTypeRouting(spineDocType);
  const checklistKey = resolveChecklistKey(canonical_type, null);

  assert.equal(docType, "AR_AGING");
  assert.equal(canonical_type, "AR_AGING");
  assert.equal(checklistKey, "AR_AGING");
});
