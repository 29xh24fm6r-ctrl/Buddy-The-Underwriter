/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — structural tripwire confirming the
 * borrower-facing business-plan attestation route uses the token-resolution
 * auth pattern (resolveBorrowerToken), NOT the bank-staff/Clerk pattern —
 * same convention as SPEC-M7's sba-forms route tripwire.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/portal/[token]/business-plan/attestation/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: imports resolveBorrowerToken, not Clerk/assertDealAccess auth", () => {
  const src = readSrc();
  assert.match(src, /import\s*\{\s*resolveBorrowerToken\s*\}\s*from\s*["']@\/lib\/portal\/resolveBorrowerToken["']/);
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

  const postBody = src.slice(postIdx);
  assert.match(postBody, /resolveBorrowerToken\(token\)/);
});

test("TRIPWIRE: POST requires an explicit confirm:true body before recording an attestation", () => {
  const src = readSrc();
  assert.match(src, /body\.confirm !== true/);
});
