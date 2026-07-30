/**
 * SPEC-M6 ANTICIPATED-INTERROGATION-1 — structural tripwire confirming the
 * manual re-run endpoint is bank-staff-authed (requireUser + ensureDealBankAccess),
 * same convention as src/app/api/deals/[dealId]/activity/route.ts — this is
 * a banker action, never borrower- or lender-facing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "src/app/api/brokerage/deals/[dealId]/committee-interrogation/route.ts",
    ),
    "utf8",
  );
}

test("TRIPWIRE: route imports requireUser and ensureDealBankAccess", () => {
  const src = readSrc();
  assert.match(src, /import\s*\{\s*requireUser\s*\}\s*from\s*["']@\/lib\/server\/authz["']/);
  assert.match(
    src,
    /import\s*\{\s*ensureDealBankAccess\s*\}\s*from\s*["']@\/lib\/tenant\/ensureDealBankAccess["']/,
  );
});

test("TRIPWIRE: POST checks requireUser before ensureDealBankAccess, both before calling the interrogation", () => {
  const src = readSrc();
  const requireUserIdx = src.indexOf("await requireUser()");
  const accessIdx = src.indexOf("ensureDealBankAccess(dealId)");
  const runIdx = src.indexOf("runHostileInterrogationForDeal(dealId, access.bankId, sb)");
  assert.ok(requireUserIdx > -1 && accessIdx > -1 && runIdx > -1);
  assert.ok(requireUserIdx < accessIdx, "auth must be checked before tenant access");
  assert.ok(accessIdx < runIdx, "tenant access must be checked before running the interrogation");
});

test("TRIPWIRE: unauthorized returns 401, forbidden returns 403", () => {
  const src = readSrc();
  assert.match(src, /status:\s*401/);
  assert.match(src, /status:\s*403/);
});
