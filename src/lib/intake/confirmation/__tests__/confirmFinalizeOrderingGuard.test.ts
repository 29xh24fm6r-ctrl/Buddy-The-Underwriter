/**
 * Confirm Route — Finalization Ordering CI Guards
 *
 * Structural invariants ensuring the confirm route never violates
 * the DB constraint finalized_doc_must_have_checklist_key.
 *
 * The fix: finalized_at is written in a SEPARATE update AFTER
 * checklist_key is persisted and reconcile has run.
 *
 * CONFIRM-G1: finalized_at must NOT appear in the main patch object
 * CONFIRM-G2: finalized_at must NOT appear in the RPC meta update
 * CONFIRM-G3: finalized_at MUST appear in a separate update AFTER reconcile
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CONFIRM_ROUTE = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
);

function readRoute(): string {
  return fs.readFileSync(CONFIRM_ROUTE, "utf8");
}

describe("Confirm Route — Finalization Ordering Guards", () => {
  // ─── CONFIRM-G1: finalized_at NOT in main patch ────────────────────────────
  test("CONFIRM-G1: finalized_at must NOT be stamped in the main patch object", () => {
    const src = readRoute();

    // Find the patch construction block (between "const patch:" and the RPC branch)
    const patchStart = src.indexOf("const patch: Record<string, unknown>");
    const rpcBranch = src.indexOf("// ── Phase M-D: Use atomic RPC");
    assert.ok(patchStart > -1, "patch object must exist");
    assert.ok(rpcBranch > -1, "RPC branch must exist");

    const patchBlock = src.slice(patchStart, rpcBranch);

    assert.ok(
      !patchBlock.includes("patch.finalized_at"),
      "CONFIRM-G1: finalized_at must NOT be set in the main patch object — it must be a separate write after reconcile",
    );
    assert.ok(
      !patchBlock.includes("patch.quality_status"),
      "CONFIRM-G1: quality_status must NOT be set in the main patch object — it must be a separate write after reconcile",
    );
  });

  // ─── CONFIRM-G2: finalized_at NOT in RPC meta update ──────────────────────
  test("CONFIRM-G2: finalized_at must NOT appear in the RPC meta update", () => {
    const src = readRoute();

    // Find the RPC meta update block (between "Stamp remaining metadata" and the else branch)
    const metaStart = src.indexOf("// Stamp remaining metadata that the RPC");
    const elseBranch = src.indexOf("} else {", metaStart);
    assert.ok(metaStart > -1, "RPC meta update must exist");
    assert.ok(elseBranch > -1, "else branch must exist");

    const metaBlock = src.slice(metaStart, elseBranch);

    assert.ok(
      !metaBlock.includes("finalized_at"),
      "CONFIRM-G2: finalized_at must NOT appear in the RPC meta update — it must be a separate write after reconcile",
    );
    assert.ok(
      !metaBlock.includes("quality_status"),
      "CONFIRM-G2: quality_status must NOT appear in the RPC meta update — it must be a separate write after reconcile",
    );
  });

  // ─── CONFIRM-G3: finalized_at in separate write AFTER reconcile ───────────
  test("CONFIRM-G3: finalized_at must be written in a separate update AFTER reconcile", () => {
    const src = readRoute();

    // Reconcile block must come BEFORE the finalization write
    const reconcilePos = src.indexOf("reconcileChecklistForDeal");
    const finalizationBlock = src.indexOf("Finalization: separate write AFTER checklist_key persisted");
    assert.ok(reconcilePos > -1, "reconcile call must exist");
    assert.ok(finalizationBlock > -1, "finalization block must exist");
    assert.ok(
      reconcilePos < finalizationBlock,
      "CONFIRM-G3: reconcile must come BEFORE the finalization write",
    );

    // The finalization block must re-read checklist_key before writing finalized_at
    const finalizationSrc = src.slice(finalizationBlock);
    assert.ok(
      finalizationSrc.includes("checklist_key") &&
        finalizationSrc.includes("finalized_at"),
      "CONFIRM-G3: finalization block must re-read checklist_key and write finalized_at",
    );

    // Must fail closed when checklist_key is null
    assert.ok(
      finalizationSrc.includes("finalization_blocked"),
      "CONFIRM-G3: finalization must fail closed when checklist_key is null after persist",
    );

    // The finalization write must include quality_status + finalized_at
    assert.ok(
      finalizationSrc.includes('quality_status: "PASSED"') &&
        finalizationSrc.includes("finalized_at: now"),
      "CONFIRM-G3: finalization write must set quality_status and finalized_at together",
    );
  });
});
