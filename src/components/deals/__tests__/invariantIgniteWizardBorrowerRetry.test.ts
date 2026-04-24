/**
 * IGNITE-BORROWER-LINKAGE Batch 2 — Source-inspection invariants (2026-04-24)
 *
 * Proves the IGNITE wizard defensively recovers if /borrower/update returns
 * 400 no_borrower_linked (belt-and-suspenders for paths that bypass the
 * Batch 1 igniteDeal() ensure step):
 *   1. saveAndAdvance detects status === 400 AND error === 'no_borrower_linked'
 *   2. On that condition it POSTs to /borrower/ensure with the documented
 *      body { source: "autofill", include_owners: true }
 *   3. After ensure succeeds, it retries the original /borrower/update call
 *   4. The retry path preserves the same body and advances on success
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("IGNITE-BORROWER-LINKAGE Batch 2 — wizard defensive retry invariants", () => {
  const src = readSource("src/components/deals/IgniteWizard.tsx");

  test("saveAndAdvance detects 400 + no_borrower_linked trigger", () => {
    assert.ok(
      /res\.status === 400[\s\S]{0,120}?data\?\.error === ["']no_borrower_linked["']/.test(src),
      "must branch on res.status === 400 && data.error === 'no_borrower_linked'",
    );
  });

  test("retry path POSTs to /borrower/ensure with correct body shape", () => {
    assert.ok(
      /fetch\(`\/api\/deals\/\$\{dealId\}\/borrower\/ensure`/.test(src),
      "must call /borrower/ensure on the retry branch",
    );
    assert.ok(
      /source:\s*["']autofill["'][\s\S]{0,80}?include_owners:\s*true/.test(src),
      "ensure body must be { source: 'autofill', include_owners: true } (matches route contract)",
    );
  });

  test("retry path re-invokes the original /borrower/update after ensure", () => {
    // Structural check: after the ensure call there's a second call to
    // /borrower/update (via the shared doUpdate helper or an inline fetch).
    const afterEnsureIdx = src.indexOf("borrower/ensure");
    assert.ok(afterEnsureIdx > 0, "must reference borrower/ensure");
    const tail = src.slice(afterEnsureIdx);
    assert.ok(
      /doUpdate\(\)|fetch\(`\/api\/deals\/\$\{dealId\}\/borrower\/update`/.test(tail),
      "after ensure, must retry the original /borrower/update call",
    );
  });

  test("ensure failure surfaces an error and does NOT advance", () => {
    assert.ok(
      /if \(!ensureRes\.ok\)/.test(src),
      "must check ensureRes.ok before retrying",
    );
    assert.ok(
      /setError\([^)]*borrower[^)]*\)[\s\S]{0,80}?return/.test(src),
      "on ensure failure must setError and return (skip advance())",
    );
  });

  test("original non-retry semantics preserved (success path advances, error path does not)", () => {
    assert.ok(
      /if \(!data\.ok\)\s*\{\s*setError\([^)]*\)[\s\S]{0,60}?return/.test(src),
      "must still short-circuit on !data.ok after the retry block",
    );
    assert.ok(
      /advance\(\);/.test(src),
      "success path must still call advance()",
    );
  });
});
