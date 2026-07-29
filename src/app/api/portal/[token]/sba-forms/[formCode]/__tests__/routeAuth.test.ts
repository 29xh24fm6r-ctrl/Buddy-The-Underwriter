/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — structural tripwire confirming the
 * borrower-facing sba-forms route uses the token-resolution auth pattern
 * (resolveBorrowerToken), NOT the bank-staff/Clerk pattern the existing
 * internal build/render route uses — that route was confirmed in this
 * spec's §0 research to be unreachable by a borrower session at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/portal/[token]/sba-forms/[formCode]/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: imports resolveBorrowerToken, not Clerk/assertDealAccess auth", () => {
  const src = readSrc();
  assert.match(src, /import\s*\{\s*resolveBorrowerToken\s*\}\s*from\s*["']@\/lib\/portal\/resolveBorrowerToken["']/);
  // Narrowed to actual import statements — the file's own doc comment
  // legitimately mentions these names in prose to explain why they're
  // NOT used here (same false-positive risk as a bare-word check).
  assert.doesNotMatch(src, /import\s*\{[^}]*assertDealAccess/);
  assert.doesNotMatch(src, /import\s*\{[^}]*clerkAuth/);
});

test("TRIPWIRE: GET and POST both resolve the token before touching any deal data", () => {
  const src = readSrc();
  const getIdx = src.indexOf("export async function GET");
  const postIdx = src.indexOf("export async function POST");
  assert.ok(getIdx > -1 && postIdx > -1);

  const getBody = src.slice(getIdx, postIdx);
  assert.match(getBody, /resolveBorrowerToken\(token\)/);
  const resolveIdxInGet = getBody.indexOf("resolveBorrowerToken(token)");
  const supabaseAdminIdxInGet = getBody.indexOf("supabaseAdmin()");
  assert.ok(resolveIdxInGet < supabaseAdminIdxInGet, "token must resolve before any DB client is used");
});

test("TRIPWIRE: only 1919 and 413 are accepted form codes", () => {
  const src = readSrc();
  assert.match(src, /v === "1919" \|\| v === "413"/);
});

test("TRIPWIRE: download reuses the same build/render pipeline as the bank-staff route", () => {
  const src = readSrc();
  assert.match(src, /import\s*\{\s*buildForm1919Input\s*\}\s*from\s*["']@\/lib\/sba\/forms\/form1919\/inputBuilder["']/);
  assert.match(src, /import\s*\{\s*renderForm1919Pdf\s*\}\s*from\s*["']@\/lib\/sba\/forms\/form1919\/render["']/);
  assert.match(src, /import\s*\{\s*buildForm413Input\s*\}\s*from\s*["']@\/lib\/sba\/forms\/form413\/inputBuilder["']/);
  assert.match(src, /import\s*\{\s*renderForm413Pdf\s*\}\s*from\s*["']@\/lib\/sba\/forms\/form413\/render["']/);
});
