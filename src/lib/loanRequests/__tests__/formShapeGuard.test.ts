// SPEC-LOAN-REQUEST-FORM-V2
//
// Structural guard: LoanRequestsSection uses shape config and live rates.
// Pure source-grep — no server-only imports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FORM_PATH = resolve(
  process.cwd(),
  "src/components/loanRequests/LoanRequestsSection.tsx",
);

test("LoanRequestsSection imports getProductShape", () => {
  const src = readFileSync(FORM_PATH, "utf8");
  assert.match(
    src,
    /import[\s\S]*getProductShape[\s\S]*from\s*["']@\/lib\/loanRequests\/productShapeConfig["']/,
    "LoanRequestsSection must import getProductShape from productShapeConfig",
  );
});

test("LoanRequestsSection does not render term/amort unconditionally", () => {
  const src = readFileSync(FORM_PATH, "utf8");
  // The old pattern was a bare grid containing requested_term_months input
  // without any shape guard. The new code wraps it in showTermAmort conditional.
  // Verify the old unconditional pattern is gone.
  const unconditional = /\{\/\*\s*Term preferences\s*\*\/\}\s*\n\s*<div className="grid/;
  assert.ok(
    !unconditional.test(src),
    "LoanRequestsSection must not render term/amort fields unconditionally",
  );
});

test("LoanRequestsSection fetches live rates from /api/rates/latest", () => {
  const src = readFileSync(FORM_PATH, "utf8");
  assert.ok(
    src.includes("/api/rates/latest"),
    "LoanRequestsSection must fetch from /api/rates/latest",
  );
});
