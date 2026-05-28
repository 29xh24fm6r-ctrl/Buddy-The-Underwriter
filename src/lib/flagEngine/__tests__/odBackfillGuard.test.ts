/**
 * BUGFIX-OD-DETAIL-BACKFILL-REPROCESS-1 — CI Guard Tests
 *
 * Guards:
 * 1. Backfill API route exists
 * 2. Backfill route runs extractOtherDeductionsDetail
 * 3. Backfill route writes via writeFactsBatch
 * 4. Backfill route regenerates flags after writing
 * 5. RiskClient shows BackfillOdDetailButton when no detail exists
 * 6. BackfillOdDetailButton POSTs to /od-detail/backfill
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RISK_CLIENT = read("src/app/(app)/deals/[dealId]/risk/RiskClient.tsx");

describe("BUGFIX-OD-DETAIL-BACKFILL-REPROCESS-1 guards", () => {

  test("Guard 1: backfill route exists", () => {
    assert.ok(
      existsSync(resolve(repoRoot, "src/app/api/deals/[dealId]/flags/od-detail/backfill/route.ts")),
    );
  });

  test("Guard 2: backfill route runs OD detail extractor", () => {
    const src = read("src/app/api/deals/[dealId]/flags/od-detail/backfill/route.ts");
    assert.match(src, /extractOtherDeductionsDetail/, "Must call the OD detail extractor");
    assert.match(src, /document_ocr_results/, "Must load OCR text from document_ocr_results");
  });

  test("Guard 3: backfill route writes facts", () => {
    const src = read("src/app/api/deals/[dealId]/flags/od-detail/backfill/route.ts");
    assert.match(src, /writeFactsBatch/, "Must write facts via writeFactsBatch");
    assert.match(src, /TAX_RETURN_OTHER_DEDUCTIONS_DETAIL/, "Must use correct fact type");
  });

  test("Guard 4: backfill route regenerates flags", () => {
    const src = read("src/app/api/deals/[dealId]/flags/od-detail/backfill/route.ts");
    assert.match(src, /generateAndPersistFlags/, "Must regenerate flags after backfill");
  });

  test("Guard 5: RiskClient shows backfill button when no OD detail", () => {
    assert.match(RISK_CLIENT, /BackfillOdDetailButton/, "Must render BackfillOdDetailButton");
    assert.match(RISK_CLIENT, /No line-level detail extracted yet/, "Must show 'no detail' message");
  });

  test("Guard 6: backfill button POSTs to correct endpoint", () => {
    assert.match(RISK_CLIENT, /od-detail\/backfill/, "Must POST to /od-detail/backfill");
  });
});
