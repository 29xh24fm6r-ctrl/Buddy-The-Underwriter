import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  runTier2Structural,
  _STRUCTURAL_PATTERNS_FOR_TESTING,
} from "../tier2Structural";
import { normalizeDocument } from "../normalizeDocument";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeDoc(text: string, filename = "test.pdf") {
  return normalizeDocument("test-art", text, filename, "application/pdf");
}

// ─── Rent Roll ──────────────────────────────────────────────────────────────

test("Tier 2: rent roll with tenant table → RENT_ROLL", () => {
  const text = [
    "Rent Roll as of January 2024",
    "Tenant\tUnit #\tSq Ft\tMonthly Rent\tLease Expiration",
    "ABC Corp\t101\t1,500\t$2,500\t12/31/2025",
    "XYZ LLC\t102\t2,000\t$3,200\t06/30/2024",
    "Smith Inc\t103\t800\t$1,800\t03/31/2025",
    "Jones Co\t104\t1,200\t$2,100\t09/30/2024",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "RENT_ROLL");
  assert.equal(result.patternId, "RENT_ROLL_TENANT_TABLE");
  assert.ok(result.confidence >= 0.75 && result.confidence <= 0.89);
  assert.ok(result.evidence.length > 0);
});

test("Tier 2: plain text without tenant table → no rent roll match", () => {
  const result = runTier2Structural(makeDoc("This is a general business document about tenant relations."));
  assert.equal(result.matched, false);
});

// ─── Personal Financial Statement ───────────────────────────────────────────

test("Tier 2: PFS with assets + liabilities + net worth → PFS", () => {
  const text = [
    "Personal Financial Statement",
    "Name: John Smith",
    "",
    "ASSETS",
    "Cash on Hand: $50,000",
    "Savings Account: $100,000",
    "Real Estate: $500,000",
    "",
    "LIABILITIES",
    "Mortgage Balance: $300,000",
    "Loan Payable: $25,000",
    "",
    "Net Worth: $325,000",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "PFS");
  assert.equal(result.patternId, "PFS_ASSET_LIABILITY_FORMAT");
});

test("Tier 2: SBA Form 413 with assets → PFS", () => {
  const text = "SBA Form 413\nPersonal Assets\nCash on Hand: $20,000\nSavings: $50,000";
  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "PFS");
});

// ─── Multi-Year P&L ─────────────────────────────────────────────────────────

test("Tier 2: multi-year P&L with year columns → INCOME_STATEMENT (not T12)", () => {
  const text = [
    "Financial Summary",
    "                    2022        2023        2024",
    "Revenue          $500,000    $550,000    $600,000",
    "COGS             $200,000    $220,000    $240,000",
    "Gross Profit     $300,000    $330,000    $360,000",
    "Net Income       $100,000    $120,000    $140,000",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
  assert.equal(result.patternId, "MULTI_YEAR_PL");
  assert.notEqual(result.docType, "T12");
});

// ─── Operating Statement → INCOME_STATEMENT (never T12) ─────────────────────

test("Tier 2: monthly operating statement → INCOME_STATEMENT (never T12)", () => {
  const text = [
    "Property Operating Statement",
    "           Jan    Feb    Mar    Apr    May    Jun",
    "Rental Income   $10,000 $10,000 $10,000 $10,000 $10,000 $10,000",
    "Operating Expenses $3,000  $3,000  $3,000  $3,000  $3,000  $3,000",
    "NOI              $7,000  $7,000  $7,000  $7,000  $7,000  $7,000",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
  assert.equal(result.patternId, "OPERATING_STATEMENT_MONTHLY");
  assert.notEqual(result.docType, "T12");
});

test("Tier 2: quarterly operating statement → INCOME_STATEMENT", () => {
  const text = [
    "Quarterly Operating Report",
    "           Q1       Q2       Q3       Q4",
    "Income    $30,000  $32,000  $31,000  $33,000",
    "Expenses  $12,000  $13,000  $12,500  $14,000",
    "Net Operating Income $18,000 $19,000 $18,500 $19,000",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
});

// ─── Bank Statement Transaction Log ─────────────────────────────────────────

test("Tier 2: bank statement transaction log → BANK_STATEMENT", () => {
  const text = [
    "Account Activity Report",
    "Transaction Date  Description            Debit    Credit    Balance",
    "01/02/2024       ACH Deposit                     $5,000    $15,000",
    "01/05/2024       Check #1234           $500                $14,500",
    "01/10/2024       Wire Transfer                   $10,000   $24,500",
    "01/15/2024       Withdrawal            $1,000             $23,500",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "BANK_STATEMENT");
  assert.equal(result.patternId, "BANK_STMT_TRANSACTION_LOG");
});

// ─── No match ───────────────────────────────────────────────────────────────

test("Tier 2: plain text → no match", () => {
  const result = runTier2Structural(makeDoc("Dear Sir, please find attached the lease agreement for review."));
  assert.equal(result.matched, false);
  assert.equal(result.docType, null);
  assert.equal(result.patternId, null);
});

// ─── Confidence ranges ──────────────────────────────────────────────────────

test("Tier 2: all pattern confidences are 0.75–0.89", () => {
  for (const pattern of _STRUCTURAL_PATTERNS_FOR_TESTING) {
    assert.ok(
      pattern.confidence >= 0.75 && pattern.confidence <= 0.89,
      `Pattern ${pattern.patternId} confidence ${pattern.confidence} outside 0.75-0.89`,
    );
  }
});

// ─── NO T12 output (critical invariant) ─────────────────────────────────────

test("Tier 2: NO pattern maps to T12", () => {
  for (const pattern of _STRUCTURAL_PATTERNS_FOR_TESTING) {
    assert.notEqual(
      pattern.docType,
      "T12",
      `Pattern ${pattern.patternId} maps to T12 — Buddy invariant violation`,
    );
  }
});

test("Tier 2: source file does not map any pattern to T12", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/classification/tier2Structural.ts"),
    "utf8",
  );

  // Find the STRUCTURAL_PATTERNS array
  const patternsSection = src.slice(
    src.indexOf("const STRUCTURAL_PATTERNS"),
    src.indexOf("// Public API"),
  );

  // Verify no docType is T12
  const docTypeMatches = [...patternsSection.matchAll(/docType:\s*"([^"]+)"/g)];
  for (const m of docTypeMatches) {
    assert.notEqual(
      m[1],
      "T12",
      `Structural pattern source maps docType to T12 — invariant violation`,
    );
  }
});

// ─── v2.1 additions ──────────────────────────────────────────────────────────

test("Tier 2: debt schedule with lender + balance → DEBT_SCHEDULE", () => {
  const text = [
    "Debt Schedule",
    "As of December 31, 2024",
    "",
    "Lender          Balance      Payment    Maturity     Interest Rate",
    "Bank of America $500,000     $4,200     12/31/2029   5.25%",
    "Wells Fargo     $250,000     $2,100     06/30/2027   4.75%",
    "SBA 7(a)        $150,000     $1,400     03/31/2030   6.00%",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "DEBT_SCHEDULE");
  assert.equal(result.patternId, "DEBT_SCHEDULE_FORMAT");
  assert.ok(result.confidence >= 0.75 && result.confidence <= 0.89);
});

test("Tier 2: schedule of liabilities with creditor → DEBT_SCHEDULE", () => {
  const text = [
    "Schedule of Liabilities",
    "",
    "Creditor    Original Amount    Current Balance    Payment",
    "ABC Bank    $1,000,000         $750,000          $8,500",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "DEBT_SCHEDULE");
});

test("Tier 2: AR aging with bucket columns → AR_AGING", () => {
  const text = [
    "Accounts Receivable Aging",
    "As of January 31, 2024",
    "",
    "Customer      Current    30 days    60 days    90 days    120 days    Total",
    "ABC Corp      $5,000     $2,000     $500       $0         $0          $7,500",
    "XYZ Inc       $3,000     $1,000     $1,000     $500       $200        $5,700",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "AR_AGING");
  assert.equal(result.patternId, "AR_AGING_FORMAT");
  assert.ok(result.confidence >= 0.75 && result.confidence <= 0.89);
});

test("Tier 2: A/R aging alternate format → AR_AGING", () => {
  const text = [
    "A/R Aging Summary",
    "",
    "Current    30d    60d    90d+",
    "$10,000    $3,000 $1,000 $500",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "AR_AGING");
});

test("Tier 2: voided check with routing number → VOIDED_CHECK", () => {
  const text = [
    "VOID",
    "",
    "Pay to the order of _______________",
    "                                    Check",
    "",
    "Routing Number: 021000021",
    "Account Number: 123456789",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "VOIDED_CHECK");
  assert.equal(result.patternId, "VOIDED_CHECK_FORMAT");
  assert.ok(result.confidence >= 0.75 && result.confidence <= 0.89);
});

test("Tier 2: voided check with account label → VOIDED_CHECK", () => {
  const text = [
    "VOIDED CHECK",
    "Account #: 9876543210",
    "Routing #: 021000089",
  ].join("\n");

  const result = runTier2Structural(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "VOIDED_CHECK");
});

test("Tier 2: no new v2.1 pattern maps to T12", () => {
  const v21Patterns = _STRUCTURAL_PATTERNS_FOR_TESTING.filter(
    (p) =>
      p.patternId === "DEBT_SCHEDULE_FORMAT" ||
      p.patternId === "AR_AGING_FORMAT" ||
      p.patternId === "VOIDED_CHECK_FORMAT",
  );
  assert.ok(v21Patterns.length === 3, "Should find all 3 v2.1 patterns");
  for (const p of v21Patterns) {
    assert.notEqual(p.docType, "T12", `v2.1 pattern ${p.patternId} maps to T12`);
  }
});

test("Tier 2: all v2.1 pattern confidences are 0.75–0.89", () => {
  const v21Patterns = _STRUCTURAL_PATTERNS_FOR_TESTING.filter(
    (p) =>
      p.patternId === "DEBT_SCHEDULE_FORMAT" ||
      p.patternId === "AR_AGING_FORMAT" ||
      p.patternId === "VOIDED_CHECK_FORMAT",
  );
  for (const p of v21Patterns) {
    assert.ok(
      p.confidence >= 0.75 && p.confidence <= 0.89,
      `v2.1 pattern ${p.patternId} confidence ${p.confidence} outside 0.75-0.89`,
    );
  }
});
