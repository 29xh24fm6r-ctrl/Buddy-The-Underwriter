/**
 * Phase U — Slot Entity Binding Immutability CI Guards
 *
 * Structural invariants ensuring:
 * - bind-slots route checks slot status before allowing entity binding changes
 * - confirm-attribution route checks slot status before allowing entity binding changes
 * - Both routes trigger readiness recompute after successful binding
 *
 * DB-level immutability (trigger) is enforced in Supabase migration.
 * These guards enforce the application-layer defense-in-depth.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Phase U — Slot Entity Binding Immutability Guards", () => {
  // ─── U-G1: bind-slots checks slot.status ──────────────────────────────────
  test("U-G1: bind-slots checks slot.status before updating required_entity_id", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/bind-slots/route.ts",
    );

    // Must select status field
    assert.ok(
      src.includes("status") && src.includes(".select("),
      "U-G1: bind-slots must select slot status field",
    );

    // Must check for non-empty and return 409
    assert.ok(
      src.includes("slot_not_rebindable_attached"),
      "U-G1: bind-slots must return slot_not_rebindable_attached error for non-empty slots",
    );

    assert.ok(
      src.includes("409"),
      "U-G1: bind-slots must return 409 status for non-rebindable slots",
    );
  });

  // ─── U-G2: confirm-attribution checks slot.status ─────────────────────────
  test("U-G2: confirm-attribution checks slot.status before updating required_entity_id", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/identity/confirm-attribution/route.ts",
    );

    // Must load slot with status
    assert.ok(
      src.includes("status") && src.includes(".select("),
      "U-G2: confirm-attribution must select slot status field",
    );

    // Must check for non-empty and return 409
    assert.ok(
      src.includes("slot_not_rebindable_attached"),
      "U-G2: confirm-attribution must return slot_not_rebindable_attached error for non-empty slots",
    );

    assert.ok(
      src.includes("409"),
      "U-G2: confirm-attribution must return 409 status for non-rebindable slots",
    );
  });

  // ─── U-G3: bind-slots triggers readiness recompute ────────────────────────
  test("U-G3: bind-slots triggers readiness recompute after binding", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/bind-slots/route.ts",
    );

    assert.ok(
      src.includes("recomputeDealReady"),
      "U-G3: bind-slots must call recomputeDealReady after entity binding",
    );
  });

  // ─── U-G4: confirm-attribution triggers readiness recompute ───────────────
  test("U-G4: confirm-attribution triggers readiness recompute after binding", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/identity/confirm-attribution/route.ts",
    );

    assert.ok(
      src.includes("recomputeDealReady"),
      "U-G4: confirm-attribution must call recomputeDealReady after entity binding",
    );
  });
});
