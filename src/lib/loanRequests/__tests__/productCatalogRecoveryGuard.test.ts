/**
 * SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 #2:
 * The Add Loan Request button must never be silently disabled. When the
 * product catalog is empty or the fetch errors, the banker must see:
 *   - a visible reason (amber alert with role="alert")
 *   - an explicit Retry button (not just "refresh the page")
 *   - an admin link for the empty-catalog case
 * and the admin route must exist so the link is not a 404.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const READ = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SECTION = "src/components/loanRequests/LoanRequestsSection.tsx";

test("[product-catalog-1] empty-state and error-state alerts use role=\"alert\"", () => {
  const src = READ(SECTION);
  assert.match(
    src,
    /data-testid="loan-products-error"/,
    "LoanRequestsSection must mark the productTypesError alert with a stable testid",
  );
  assert.match(
    src,
    /data-testid="loan-products-empty"/,
    "LoanRequestsSection must mark the productTypesEmpty alert with a stable testid",
  );
  // role="alert" appears in both error and empty alert blocks.
  const roleHits = src.match(/role="alert"/g) ?? [];
  assert.ok(
    roleHits.length >= 2,
    "Both error and empty alerts must have role=\"alert\" for accessibility",
  );
});

test("[product-catalog-2] error alert exposes a Retry button that calls loadProductTypes", () => {
  const src = READ(SECTION);
  const errorBlockMatch = src.match(
    /data-testid="loan-products-error"[\s\S]*?<\/div>/,
  );
  assert.ok(
    errorBlockMatch,
    "could not locate the productTypesError block",
  );
  assert.match(
    errorBlockMatch![0],
    /Retry/,
    "productTypesError block must contain a Retry affordance",
  );
  assert.match(
    errorBlockMatch![0],
    /loadProductTypes\(\)/,
    "Retry button must invoke loadProductTypes() so the banker is not stuck refreshing the whole page",
  );
});

test("[product-catalog-3] empty alert exposes Retry + Configure Loan Products link", () => {
  const src = READ(SECTION);
  // Locate the empty block by its testid, then scan forward through the
  // closing tags. We accept the whole tail of the file from that anchor
  // because the actual JSX nests <span> with the button + link.
  const idx = src.indexOf('data-testid="loan-products-empty"');
  assert.ok(
    idx >= 0,
    "could not locate productTypesEmpty alert (data-testid missing)",
  );
  const window = src.slice(idx, idx + 1500);
  assert.match(
    window,
    /Retry/,
    "productTypesEmpty block must contain a Retry affordance",
  );
  assert.match(
    window,
    /Configure Loan Products/,
    "productTypesEmpty block must contain the Configure Loan Products admin link",
  );
  assert.match(
    window,
    /href="\/admin\/loan-products"/,
    "Configure Loan Products link must target /admin/loan-products",
  );
});

test("[product-catalog-4] /admin/loan-products page exists so the affordance is not a 404", () => {
  const adminPage = resolve(
    ROOT,
    "src/app/(app)/admin/loan-products/page.tsx",
  );
  assert.ok(
    existsSync(adminPage),
    "admin landing page for loan-products must exist (LoanRequestsSection links to /admin/loan-products)",
  );
  const src = readFileSync(adminPage, "utf8");
  assert.match(
    src,
    /bank_loan_product_types/,
    "admin page must reference the bank-scoped overrides table so the admin sees the actual catalog state",
  );
  assert.match(
    src,
    /loan_product_types/,
    "admin page must reference the global catalog table",
  );
});
