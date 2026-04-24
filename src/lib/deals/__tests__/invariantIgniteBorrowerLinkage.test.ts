/**
 * IGNITE-BORROWER-LINKAGE Batch 1 — Source-inspection invariants (2026-04-24)
 *
 * Proves:
 *   1. igniteDeal has a Step 1.6 that gates on source === "banker_upload"
 *      and skips for banker_invite (untouched path invariant).
 *   2. Step 1.6 short-circuits when the deal already has a borrower_id
 *      (idempotency — re-ignite does not double-create).
 *   3. Step 1.6 inserts into borrowers then updates deals.borrower_id —
 *      in that order (placeholder create precedes attach).
 *   4. Create/attach failures return a structured error code and write a
 *      ledger event (never silently advance).
 *   5. Autofill from docs is invoked fire-and-forget (.then/.catch chain),
 *      not awaited (blocking ignite on doc extraction is out of scope).
 *   6. Backfill migration file is committed with the idempotent guard
 *      (WHERE borrower_id IS NULL) and the placeholder values match
 *      igniteDeal's inline path.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("IGNITE-BORROWER-LINKAGE Batch 1 — invariants", () => {
  const src = readSource("src/lib/deals/igniteDealCore.ts");

  test("Step 1.6 gated on source === 'banker_upload' (banker_invite untouched)", () => {
    assert.ok(
      /Step 1\.6[\s\S]*?banker_upload/i.test(src),
      "must declare Step 1.6 and reference banker_upload in comment/code",
    );
    const stepRegion = src.split(/Step 1\.6/)[1]?.split(/Step 2:/)[0] ?? "";
    assert.ok(
      /if \(source === ["']banker_upload["']\)/.test(stepRegion),
      "Step 1.6 must be gated on source === 'banker_upload' — banker_invite stays untouched",
    );
  });

  test("idempotent: short-circuits when deal already has borrower_id", () => {
    assert.ok(
      /select\(\s*["']borrower_id["']\s*\)/.test(src),
      "must select existing borrower_id before creating a new one",
    );
    assert.ok(
      /if \(!dealNow\?\.borrower_id\)/.test(src),
      "must gate placeholder creation on !dealNow.borrower_id (idempotent re-ignite)",
    );
  });

  test("borrower insert precedes deals.borrower_id update (create → attach order)", () => {
    const borrowersInsertIdx = src.indexOf('.from("borrowers")');
    const dealsUpdateAttachIdx = src.indexOf("borrower_id: newBorrower.id");
    assert.ok(borrowersInsertIdx > 0, "must insert into borrowers table");
    assert.ok(
      dealsUpdateAttachIdx > 0,
      "must update deals with borrower_id: newBorrower.id",
    );
    assert.ok(
      borrowersInsertIdx < dealsUpdateAttachIdx,
      "borrower row must be created before it can be attached to the deal",
    );
  });

  test("create failure returns { ok: false, error: 'borrower_create_failed' } + ledger event", () => {
    assert.ok(
      src.includes('error: "borrower_create_failed"') ||
        src.includes("error: 'borrower_create_failed'"),
      "must return error: 'borrower_create_failed' on insert failure",
    );
    assert.ok(
      /kind:\s*["']buddy\.borrower\.ensure_failed["']/.test(src),
      "must write ledger event buddy.borrower.ensure_failed on create failure",
    );
  });

  test("attach failure returns { ok: false, error: 'borrower_attach_failed' } + ledger event", () => {
    assert.ok(
      src.includes('error: "borrower_attach_failed"') ||
        src.includes("error: 'borrower_attach_failed'"),
      "must return error: 'borrower_attach_failed' on deal update failure",
    );
    assert.ok(
      /kind:\s*["']buddy\.borrower\.attach_failed["']/.test(src),
      "must write ledger event buddy.borrower.attach_failed on attach failure",
    );
  });

  test("autofill is fire-and-forget (.then/.catch chain, not awaited)", () => {
    // Structural check: autofillBorrowerFromDocs({...}).then(...).catch(...)
    // The call must not be preceded by `await`.
    assert.ok(
      /autofillBorrowerFromDocs\(\{[\s\S]*?\}\)\s*\.then\(/.test(src),
      "autofillBorrowerFromDocs must use .then() (fire-and-forget)",
    );
    assert.ok(
      /autofillBorrowerFromDocs\([\s\S]*?\}\)\s*\.then\([\s\S]*?\)\s*\.catch\(/.test(src),
      "autofillBorrowerFromDocs must also chain .catch() to swallow failures",
    );
    // And make sure we do NOT await autofillBorrowerFromDocs:
    assert.ok(
      !/await\s+autofillBorrowerFromDocs/.test(src),
      "autofillBorrowerFromDocs must NOT be awaited — placeholder is sufficient for wizard",
    );
  });

  test("pipeline event buddy.borrower.created logged with source=ignite_banker_upload", () => {
    assert.ok(
      /eventKey:\s*["']buddy\.borrower\.created["']/.test(src),
      "must log pipeline event buddy.borrower.created on successful attach",
    );
    assert.ok(
      /source:\s*["']ignite_banker_upload["']/.test(src),
      "pipeline event meta must tag source as ignite_banker_upload",
    );
  });

  test("backfill migration file exists with idempotent guard and placeholder values", () => {
    const path = "supabase/migrations/20260424_backfill_orphan_borrowers.sql";
    assert.ok(existsSync(resolve(ROOT, path)), `${path} must exist`);

    const sql = readSource(path);
    assert.ok(
      /INSERT INTO borrowers[\s\S]*?'Pending Autofill'[\s\S]*?'Unknown'/i.test(sql),
      "migration must insert placeholder borrowers with legal_name='Pending Autofill', entity_type='Unknown'",
    );
    assert.ok(
      /UPDATE deals[\s\S]*?borrower_id = new_borrower_id[\s\S]*?borrower_id IS NULL/i.test(sql),
      "migration UPDATE must include a concurrent-attach guard (WHERE borrower_id IS NULL)",
    );
    assert.ok(
      /WHERE borrower_id IS NULL[\s\S]*?AND bank_id IS NOT NULL/i.test(sql),
      "migration cursor must filter to borrower_id IS NULL AND bank_id IS NOT NULL",
    );
  });
});
