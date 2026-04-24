/**
 * STUCK-SPREADS Batch 2 — Source-inspection invariants (2026-04-23)
 *
 * Proves:
 *   1. All three ownership_entities.display_name write sites funnel through
 *      sanitizeEntityName before persisting (prevents the PDF label-bleed
 *      garbage pattern that produced "MICHAEL NEWMARK\nTaxpayer address").
 *   2. The backfill migration is committed alongside the sanitizer.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("STUCK-SPREADS Batch 2 — display_name sanitization invariants", () => {
  test("ownership/engine.ts: AI-extracted insert path calls sanitizeEntityName", () => {
    const src = readSource("src/lib/ownership/engine.ts");
    assert.ok(
      src.includes('from "@/lib/ownership/sanitizeEntityName"'),
      "must import sanitizeEntityName",
    );
    assert.ok(
      /const cleanName = sanitizeEntityName\(e\.display_name\)/.test(src),
      "must sanitize e.display_name from AI extraction before insert",
    );
  });

  test("builderCanonicalWrite.ts: ensureOwnerEntity calls sanitizeEntityName", () => {
    const src = readSource("src/lib/builder/builderCanonicalWrite.ts");
    assert.ok(
      src.includes('from "@/lib/ownership/sanitizeEntityName"'),
      "must import sanitizeEntityName",
    );
    assert.ok(
      /sanitizeEntityName\(displayName\)/.test(src),
      "ensureOwnerEntity must sanitize its displayName parameter",
    );
  });

  test("borrower portal intake route: owner step sanitizes full_name", () => {
    const src = readSource("src/app/api/borrower/portal/[token]/intake/route.ts");
    assert.ok(
      src.includes('from "@/lib/ownership/sanitizeEntityName"'),
      "must import sanitizeEntityName",
    );
    assert.ok(
      /sanitizeEntityName\(owner\.full_name\)/.test(src),
      "must sanitize owner.full_name from borrower intake",
    );
  });

  test("migration file: sanitize_ownership_entity_display_names SQL committed", () => {
    const path = "supabase/migrations/20260423_sanitize_ownership_entity_display_names.sql";
    assert.ok(existsSync(resolve(ROOT, path)), `${path} must exist`);

    const sql = readSource(path);
    assert.ok(
      sql.includes("UPDATE ownership_entities"),
      "must update ownership_entities",
    );
    assert.ok(
      sql.includes("SPLIT_PART(display_name, E'\\n', 1)"),
      "must split on newline to strip label bleed",
    );
    assert.ok(
      sql.includes("taxpayer|spouse|filer"),
      "must strip the known label suffix family",
    );
  });
});
