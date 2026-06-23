/**
 * SPEC-BACKLOG-CLOSURE-1 CI Guards
 *
 * Item 1 (PricingAssumptionsCard LOC shape):
 *   - Fetches loan-requests on mount
 *   - Has isLocProductType helper covering 4 LOC strings
 *   - Hides Amortization field when isLoc
 *   - Hides Interest-Only field when isLoc
 *   - computePreview branches on isLoc
 *   - Labels switch to LOC variants when isLoc
 *
 * Item 2 (DealShell sticky Cockpit link):
 *   - Renders Cockpit link conditionally on !pathname.endsWith("/cockpit")
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const PRICING_CARD = "src/components/deals/cockpit/panels/PricingAssumptionsCard.tsx";
const DEAL_SHELL = "src/app/(app)/deals/[dealId]/DealShell.tsx";

// ── Guard 1: loan-requests fetch + LOC helper ────────────────────────────────

test("Guard 1: PricingAssumptionsCard fetches /api/deals/{id}/loan-requests on mount", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /\/api\/deals\/\$\{dealId\}\/loan-requests/,
    "must fetch loan-requests to learn the deal's product_type",
  );
  assert.match(
    src,
    /setProductType/,
    "must persist product_type into component state",
  );
});

test("Guard 2: isLocProductType helper covers all 4 LOC strings", () => {
  const src = read(PRICING_CARD);
  assert.match(src, /"LOC_SECURED"/);
  assert.match(src, /"LOC_UNSECURED"/);
  assert.match(src, /"LOC_RE_SECURED"/);
  assert.match(src, /"LINE_OF_CREDIT"/);
});

// ── Guard 3+4: Amortization + Interest-Only fields hidden when isLoc ─────────

test("Guard 3: Amortization field is wrapped in !isLoc conditional", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /\{!isLoc && \(\s*\n?\s*<Field label="Amortization \(months\)">/,
    "Amortization field must be hidden when isLoc — LOC products have no amort",
  );
});

test("Guard 4: Interest-Only field is wrapped in !isLoc conditional", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /\{!isLoc && \(\s*\n?\s*<Field label="Interest-Only \(months\)">/,
    "Interest-Only field must be hidden when isLoc — LOC is IO by definition",
  );
});

// ── Guard 5: computePreview takes isLoc and branches on it ───────────────────

test("Guard 5: computePreview accepts isLoc and uses IO math when true", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /function computePreview\(form: FormState, isLoc: boolean\)/,
    "computePreview signature must take isLoc",
  );
  assert.match(
    src,
    /if \(isLoc\)/,
    "computePreview must have an isLoc branch",
  );
  // LOC monthly payment formula: principal * rate / 100 / 12
  assert.match(
    src,
    /\(principal \* finalRate\) \/ 100 \/ 12/,
    "LOC monthly payment must be principal * rate / 100 / 12 (interest-only)",
  );
});

// ── Guard 6: LOC-aware preview labels ────────────────────────────────────────

test("Guard 6: Preview labels switch to LOC variants when isLoc", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /isLoc \? "Monthly Interest" : "Monthly P&I"/,
    "Monthly payment label must switch for LOC",
  );
  assert.match(
    src,
    /isLoc \? "Annual Interest Cost" : "Annual Debt Service"/,
    "Annual cost label must switch for LOC",
  );
});

// ── Guard 7: DealShell sticky Cockpit link ───────────────────────────────────

test("Guard 7: DealShell renders Cockpit link with !pathname.endsWith('/cockpit') gate", () => {
  const src = read(DEAL_SHELL);
  assert.match(
    src,
    /!pathname\?\.endsWith\("\/cockpit"\)/,
    "Cockpit link must be gated so it doesn't render on the cockpit page itself",
  );
  assert.match(
    src,
    /href=\{`\/deals\/\$\{dealId\}\/cockpit`\}/,
    "Cockpit link must point to the deal's cockpit route",
  );
});
