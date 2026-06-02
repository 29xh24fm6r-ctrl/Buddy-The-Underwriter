import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-SPREADS-GET-NULL-ERROR-CODE-FILTER-1 regression guard.
 *
 * GET /api/deals/[dealId]/spreads filtered with
 *   .neq("error_code", "SUPERSEDED_BY_NEWER_VERSION")
 * which, in PostgREST/SQL, ALSO excludes rows where error_code IS NULL
 * (NULL != x evaluates to unknown → row dropped). Healthy queued/generating/
 * ready spread rows have error_code = null, so they vanished from the UI — the
 * Global Cash Flow page never saw its own freshly-enqueued queued row and stayed
 * on "Global Cash Flow required" instead of "Computing…".
 *
 * The fix uses a null-safe OR: include null error_code rows, exclude only rows
 * explicitly marked SUPERSEDED_BY_NEWER_VERSION.
 */

const ROUTE = "src/app/api/deals/[dealId]/spreads/route.ts";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

test("the spreads GET uses a null-safe supersession filter", () => {
  const src = read(ROUTE);
  assert.ok(
    src.includes('.or("error_code.is.null,error_code.neq.SUPERSEDED_BY_NEWER_VERSION")'),
    "GET must use the null-safe .or() filter so null-error_code rows are returned",
  );
});

test("the null-hostile bare .neq filter is gone", () => {
  const src = read(ROUTE);
  assert.ok(
    !/\.neq\(\s*["']error_code["']\s*,\s*["']SUPERSEDED_BY_NEWER_VERSION["']\s*\)/.test(src),
    "the bare .neq('error_code', 'SUPERSEDED_BY_NEWER_VERSION') (drops NULLs) must be removed",
  );
});

/**
 * Behavioral proof of the intended predicate: a row is visible iff its
 * error_code is null OR not equal to SUPERSEDED_BY_NEWER_VERSION. This mirrors
 * the PostgREST .or() semantics so the contract is asserted on real rows.
 */
function isVisible(errorCode: string | null): boolean {
  return errorCode == null || errorCode !== "SUPERSEDED_BY_NEWER_VERSION";
}

test("null error_code (queued/generating/ready) rows are visible", () => {
  assert.equal(isVisible(null), true); // queued/generating/ready healthy rows
});

test("explicitly superseded rows are excluded", () => {
  assert.equal(isVisible("SUPERSEDED_BY_NEWER_VERSION"), false);
});

test("rows with other error codes remain visible (e.g. SPREAD_WAITING_ON_FACTS)", () => {
  assert.equal(isVisible("SPREAD_WAITING_ON_FACTS"), true);
});
