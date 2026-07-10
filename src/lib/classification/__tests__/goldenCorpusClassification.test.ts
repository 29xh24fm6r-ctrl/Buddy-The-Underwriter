/**
 * Golden Corpus — Classification Accuracy (Tier 1 + Tier 2)
 *
 * The slot-matching golden corpus (src/lib/intake/matching/__tests__/
 * goldenCorpus*.test.ts) protects "does this doc attach to the right
 * checklist slot" — it does not protect "does the classifier correctly
 * identify the document type" in the first place. This suite closes that
 * gap for the deterministic tiers (Tier 1 anchors, Tier 2 structural
 * patterns), which are pure and don't require network/LLM calls.
 *
 * Every case below is derived from a real confusion pair documented in
 * confusionExamples.json (the pairs already known to trip up the Tier 3
 * LLM). Each case asserts BOTH that the correct type is detected AND that
 * the confusable wrong type is NOT.
 *
 * Tier 3 (Gemini) is intentionally out of scope here — it requires live
 * Vertex credentials and is exercised by src/lib/classification/
 * __tests__/spineTripwires.test.ts at the source-invariant level instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDocument } from "../normalizeDocument";
import { runTier1Anchors } from "../tier1Anchors";
import { runTier2Structural } from "../tier2Structural";

function normalize(text: string) {
  return normalizeDocument("golden-doc", text, "document.pdf", "application/pdf");
}

// ─── INCOME_STATEMENT vs BALANCE_SHEET ──────────────────────────────────────

test("Golden: Balance Sheet (assets/liabilities/equity, no P&L) → BALANCE_SHEET, not INCOME_STATEMENT", () => {
  const text = `
    Statement of Financial Position
    As of December 31, 2024

    ASSETS
    Current Assets
    Cash and cash equivalents           $ 210,000
    Accounts receivable                 $  85,000
    Total current assets                $ 295,000
    Fixed assets, net of depreciation   $ 640,000
    Total assets                        $ 935,000

    LIABILITIES AND EQUITY
    Accounts payable                    $  40,000
    Total liabilities                   $ 310,000
    Retained earnings                   $ 400,000
    Total liabilities and equity        $ 935,000
  `;
  const doc = normalize(text);
  const tier2 = runTier2Structural(doc);
  assert.equal(tier2.matched, true);
  assert.equal(tier2.docType, "BALANCE_SHEET");
});

// ─── INCOME_STATEMENT vs RENT_ROLL ──────────────────────────────────────────

test("Golden: Rent Roll (tenant/unit table, no EBITDA) → RENT_ROLL, not INCOME_STATEMENT", () => {
  const text = `
    Rent Roll — as of 06/2025

    Unit #   Tenant           Sq Ft   Monthly Rent   Lease Expir
    101      Acme Corp        1,200   $ 2,400        12/2026
    102      Blue Sky LLC     1,450   $ 2,900        06/2027
    103      Vacant           1,100   $ 0             -
    104      Delta Retail     1,300   $ 2,650        03/2026
  `;
  const doc = normalize(text);
  const tier2 = runTier2Structural(doc);
  assert.equal(tier2.matched, true);
  assert.equal(tier2.docType, "RENT_ROLL");
});

// ─── IRS_PERSONAL vs K1 ──────────────────────────────────────────────────────

test("Golden: Schedule K-1 → K1 anchor, not IRS_PERSONAL", () => {
  const text = `
    Schedule K-1 (Form 1065)
    2024
    Partner's Share of Income, Deductions, Credits, etc.

    Part II — Information About the Partner
    Partner's share of profit: 25%
  `;
  const doc = normalize(text);
  const tier1 = runTier1Anchors(doc);
  assert.equal(tier1.matched, true);
  assert.equal(tier1.docType, "K1");
  assert.notEqual(tier1.docType, "IRS_PERSONAL");
});

test("Golden: Form 1040 → IRS_PERSONAL anchor, not K1", () => {
  const text = `
    Form 1040
    U.S. Individual Income Tax Return
    2024

    Filing Status: Single
    Wages, salaries, tips: $85,000
  `;
  const doc = normalize(text);
  const tier1 = runTier1Anchors(doc);
  assert.equal(tier1.matched, true);
  assert.equal(tier1.docType, "IRS_PERSONAL");
});

// ─── BALANCE_SHEET vs PFS ────────────────────────────────────────────────────

test("Golden: Personal Financial Statement (individual, net worth) → PFS, not BALANCE_SHEET", () => {
  const text = `
    Personal Financial Statement
    SBA Form 413

    As of 01/2025
    Name: Jane Doe
    Spouse: John Doe
    Date of Birth: 03/1975

    ASSETS
    Cash on hand and in banks           $  45,000
    Personal residence                  $ 620,000
    Life insurance cash surrender value $  12,000
    Retirement account (401k)           $ 180,000

    LIABILITIES
    Mortgage balance payable            $ 310,000
    Installment account (auto loan)     $  22,000

    Net Worth                           $ 525,000
  `;
  const doc = normalize(text);
  const tier2 = runTier2Structural(doc);
  assert.equal(tier2.matched, true);
  assert.equal(tier2.docType, "PFS");
});

test("Golden: Corporate Balance Sheet (business entity, retained earnings) → BALANCE_SHEET, not PFS", () => {
  const text = `
    Acme Manufacturing, LLC
    Balance Sheet
    As of December 31, 2024

    ASSETS
    Cash                                $  95,000
    Accounts receivable                 $ 140,000
    Inventory                           $  60,000
    Fixed assets                        $ 380,000
    Accumulated depreciation            $ (85,000)
    Total assets                        $ 590,000

    LIABILITIES AND EQUITY
    Accounts payable                    $  70,000
    Payroll liabilities                 $  15,000
    Total liabilities and equity        $ 590,000
    Retained earnings                   $ 210,000
  `;
  const doc = normalize(text);
  const tier2 = runTier2Structural(doc);
  assert.equal(tier2.matched, true);
  assert.equal(tier2.docType, "BALANCE_SHEET");
});

// ─── IRS_PERSONAL vs IRS_BUSINESS ───────────────────────────────────────────

test("Golden: Form 1120S → IRS_BUSINESS anchor, not IRS_PERSONAL", () => {
  const text = `
    Form 1120S
    U.S. Income Tax Return for an S Corporation
    2024

    EIN: 12-3456789
    Gross receipts or sales: $1,250,000
  `;
  const doc = normalize(text);
  const tier1 = runTier1Anchors(doc);
  assert.equal(tier1.matched, true);
  assert.equal(tier1.docType, "IRS_BUSINESS");
  assert.notEqual(tier1.docType, "IRS_PERSONAL");
});

// ─── Regression guard: PFS with an internal "Balance Sheet" subsection ──────
// (confusionExamples.json note: OGB PFS forms have a "Section 3 – Balance
// Sheet" subsection; the overall doc must still classify as PFS, not
// BALANCE_SHEET, when the header says Personal Financial Statement.)

test("Golden: PFS with internal 'Balance Sheet' subsection header → still PFS", () => {
  const text = `
    Personal Financial Statement
    As of 01/2025

    Section 1 - Personal Information
    Name: John Smith
    Spouse: Mary Smith
    Social Security Number: XXX-XX-1234

    Section 3 - Balance Sheet
    Cash on hand and in banks           $  30,000
    Personal residence                  $ 450,000

    LIABILITIES
    Mortgage balance payable            $ 220,000
    Notes payable to banks              $  15,000

    Net Worth                           $ 245,000
  `;
  const doc = normalize(text);
  const tier2 = runTier2Structural(doc);
  assert.equal(tier2.matched, true);
  assert.equal(tier2.docType, "PFS");
});
