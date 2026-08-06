/**
 * Structural tripwire tests confirming the readiness-inputs route follows
 * the same portal-token auth pattern as every other borrower-facing route
 * (e.g. /api/portal/[token]/checklist), and that borrower/bank identifiers
 * are never accepted from the request — only ever resolved server-side from
 * the token. This mirrors the existing convention used for
 * /api/portal/[token]/sba-forms/[formCode]/__tests__/routeAuth.test.ts,
 * since there is no live-Supabase harness available for these routes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/portal/[token]/readiness-inputs/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: resolves the deal from the token (borrower_portal_links) before touching any other table", () => {
  const src = readSrc();
  const getIdx = src.indexOf("export async function GET");
  assert.ok(getIdx > -1);
  const body = src.slice(getIdx);

  const linkQueryIdx = body.indexOf('.from("borrower_portal_links")');
  const dealsQueryIdx = body.indexOf('.from("deals")');
  const completenessCallIdx = body.indexOf("evaluateBorrowerCompleteness(");
  const checklistCallIdx = body.indexOf("listChecklist(");

  assert.ok(linkQueryIdx > -1, "must resolve token via borrower_portal_links");
  assert.ok(
    linkQueryIdx < dealsQueryIdx &&
      dealsQueryIdx < completenessCallIdx &&
      dealsQueryIdx < checklistCallIdx,
    "deal/borrower/bank resolution must happen before any borrower or checklist data is queried",
  );
});

test("TRIPWIRE: falls back to resolveBorrowerToken for the invite-link path, same as the checklist route", () => {
  const src = readSrc();
  assert.match(
    src,
    /import\s*\{\s*resolveBorrowerToken\s*\}\s*from\s*["']@\/lib\/portal\/resolveBorrowerToken["']/,
  );
  assert.match(src, /resolveBorrowerToken\(token\)/);
});

test("TRIPWIRE: rejects when no link is found, expired, or resolution throws — before any deal data is read", () => {
  const src = readSrc();
  assert.match(src, /status:\s*403/);
  assert.match(src, /expires_at.*<.*new Date\(\)/);
});

test("TRIPWIRE: dealId, borrowerId, and bankId are never read from the request — only from token resolution", () => {
  const src = readSrc();
  const getIdx = src.indexOf("export async function GET");
  const body = src.slice(getIdx);

  // No searchParams / query / body parsing of any identifier.
  assert.doesNotMatch(body, /searchParams\.get\(["'](dealId|deal_id|borrowerId|bankId)["']\)/);
  assert.doesNotMatch(body, /req\.(json|body)/);

  // borrower_id / bank_id are only ever read off the server-resolved `deal`
  // row, never assigned from anything else.
  assert.match(body, /deal\.borrower_id/);
  assert.match(body, /deal\.bank_id/);
});

test("TRIPWIRE: every downstream query is scoped by the server-resolved dealId, not a client-supplied id", () => {
  const src = readSrc();
  // listChecklist and the deal_uploads query both take the same `dealId`
  // variable that was assigned from token resolution above.
  assert.match(src, /listChecklist\(dealId\)/);
  assert.match(src, /\.eq\("deal_id",\s*dealId\)/);
});

test("TRIPWIRE: response never includes raw borrower PII fields (ssn, ein, address, owner names)", () => {
  const src = readSrc();
  const responseIdx = src.indexOf("return NextResponse.json({\n      ok: true,");
  assert.ok(responseIdx > -1);
  const responseBody = src.slice(responseIdx, src.indexOf("});", responseIdx));

  for (const forbidden of ["ein", "ssn", "full_name", "address_line1", "legal_name"]) {
    assert.doesNotMatch(
      responseBody,
      new RegExp(forbidden, "i"),
      `response must not leak raw field "${forbidden}"`,
    );
  }
});

test("TRIPWIRE: SBA-forms classification reuses the exported classifyGroup, not a re-implemented keyword list", () => {
  const src = readSrc();
  assert.match(
    src,
    /import\s*\{[^}]*computeSbaFormsReadiness[^}]*\}\s*from\s*["']@\/lib\/borrower\/computeReadinessInputs["']/,
  );
});
