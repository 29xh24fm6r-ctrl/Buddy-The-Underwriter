/**
 * SPEC-LOAN-REQUEST-CANONICALIZATION-1 — Guard tests
 *
 * Ensures the canonical /loan-request page is the single destination,
 * /loan-terms redirects, and all CTA links point to the right path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

// ── Guard 1: /loan-request renders LoanRequestsSection ──────────────────

test("loan-request page mounts LoanRequestsSection", () => {
  const src = readSource("src/app/(app)/deals/[dealId]/loan-request/page.tsx");
  assert.ok(src.includes("LoanRequestsSection"), "page must render LoanRequestsSection");
  assert.ok(src.includes("ensureDealBankAccess"), "page must enforce tenant access");
});

// ── Guard 2: cockpit Add Loan Request points to /loan-request ───────────

test("cockpit primary CTA points to /loan-request", () => {
  const nextAction = readSource("src/buddy/lifecycle/nextAction.ts");
  assert.ok(
    nextAction.includes("/loan-request"),
    "nextAction.ts must link to /loan-request",
  );
  assert.ok(
    !nextAction.includes("/loan-terms"),
    "nextAction.ts must NOT link to /loan-terms",
  );
});

test("usePrimaryCTA points to /loan-request", () => {
  const cta = readSource("src/components/deals/cockpit/hooks/usePrimaryCTA.ts");
  assert.ok(
    cta.includes("/loan-request"),
    "usePrimaryCTA must link to /loan-request",
  );
});

test("ReadinessPanel points to /loan-request", () => {
  const panel = readSource("src/components/deals/cockpit/panels/ReadinessPanel.tsx");
  assert.ok(
    panel.includes("/loan-request"),
    "ReadinessPanel must link to /loan-request",
  );
});

// ── Guard 3: /loan-terms redirects to /loan-request ─────────────────────

test("loan-terms page redirects to /loan-request", () => {
  const src = readSource("src/app/(app)/deals/[dealId]/loan-terms/page.tsx");
  assert.ok(
    src.includes("redirect("),
    "loan-terms page must call redirect()",
  );
  assert.ok(
    src.includes("/loan-request"),
    "loan-terms page must redirect to /loan-request",
  );
  // Must NOT contain the old form UI
  assert.ok(
    !src.includes("FormFieldWithDefault"),
    "loan-terms page must not render the old form",
  );
});

// ── Guard 4: LoanRequestsSection fetches /api/rates/latest ──────────────

test("LoanRequestsSection fetches live rates", () => {
  const src = readSource("src/components/loanRequests/LoanRequestsSection.tsx");
  assert.ok(
    src.includes("/api/rates/latest"),
    "LoanRequestsSection must fetch /api/rates/latest",
  );
  assert.ok(src.includes("SOFR"), "must display SOFR rate");
  assert.ok(src.includes("Prime"), "must display Prime rate");
});

// ── Guard 5: deep links use /loan-request ────────────────────────────────

test("intakeDeepLinks routes loan amount/terms to /loan-request", () => {
  const src = readSource("src/lib/deepLinks/intakeDeepLinks.ts");
  assert.ok(
    src.includes("/loan-request"),
    "intakeDeepLinks must link to /loan-request",
  );
  assert.ok(
    !src.includes("/loan-terms#loan-request"),
    "intakeDeepLinks must NOT link to /loan-terms#loan-request",
  );
});

// ── Guard 6: no remaining slate classes in LoanRequestsSection ───────────

test("LoanRequestsSection has no remaining light-mode-only slate classes", () => {
  const src = readSource("src/components/loanRequests/LoanRequestsSection.tsx");
  const slateMatches = src.match(/\bslate-\d+\b/g) ?? [];
  assert.equal(
    slateMatches.length, 0,
    `Found ${slateMatches.length} remaining slate-* class references: ${slateMatches.slice(0, 5).join(", ")}`,
  );
});

// ── Guard 7: AR LOC defaults ─────────────────────────────────────────────

test("LoanRequestsSection has AR LOC product-aware placeholders", () => {
  const src = readSource("src/components/loanRequests/LoanRequestsSection.tsx");
  assert.ok(
    src.includes("AR borrowing base") || src.includes("AR financing"),
    "LoanRequestsSection must have AR LOC-specific placeholder text",
  );
  assert.ok(
    src.includes("ACCOUNTS_RECEIVABLE") || src.includes("LOC_SECURED"),
    "LoanRequestsSection must recognize AR LOC product types",
  );
});

// ── Guard 8: pricing reads deal_loan_requests ────────────────────────────

test("PricingAssumptionsCard reads deal_loan_requests", () => {
  const src = readSource("src/components/deals/cockpit/panels/PricingAssumptionsCard.tsx");
  assert.ok(
    src.includes("/api/deals/") && src.includes("/loan-requests"),
    "PricingAssumptionsCard must fetch from /api/deals/{id}/loan-requests",
  );
});
