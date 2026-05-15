// SPEC-LOAN-REQUEST-CTA-FIX-1
//
// Structural guard: the loan-request page mounts LoanRequestsSection.
// Pure source-grep — page is a server component, no behavioral injection seam.
//
// Runner: node --test --import tsx

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PAGE_PATH = resolve(
  process.cwd(),
  "src/app/(app)/deals/[dealId]/loan-request/page.tsx",
);

test("loan-request page exists at canonical path", () => {
  assert.ok(
    existsSync(PAGE_PATH),
    "src/app/(app)/deals/[dealId]/loan-request/page.tsx must exist",
  );
});

test("loan-request page mounts LoanRequestsSection", () => {
  const src = readFileSync(PAGE_PATH, "utf8");
  assert.match(
    src,
    /import\s*\{[^}]*\bLoanRequestsSection\b[^}]*\}\s*from\s*["']@\/components\/loanRequests\/LoanRequestsSection["']/,
    "loan-request page must import LoanRequestsSection",
  );
  assert.match(
    src,
    /<LoanRequestsSection[^>]*dealId=/,
    "loan-request page must render <LoanRequestsSection dealId=... />",
  );
});

test("loan-request page enforces tenant access", () => {
  const src = readFileSync(PAGE_PATH, "utf8");
  assert.match(
    src,
    /ensureDealBankAccess/,
    "loan-request page must call ensureDealBankAccess for tenant isolation",
  );
});
