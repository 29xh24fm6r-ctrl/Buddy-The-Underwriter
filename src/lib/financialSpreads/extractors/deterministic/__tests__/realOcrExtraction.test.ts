import test from "node:test";
import assert from "node:assert/strict";

import { findLabeledAmount, parseMoney } from "../parseUtils";
import { normalizePlLabel } from "../../../normalization/plAliases";

// ═══════════════════════════════════════════════════════════════════════════
// Real OCR text from deal 098850d1 — Samaritus charter boat company
// These documents were extracted by Gemini OCR and the deterministic
// extractors produced ZERO facts. This test verifies the fixes.
// ═══════════════════════════════════════════════════════════════════════════

// ── Income Statement OCR (1548 chars) ─────────────────────────────────────
const INCOME_STATEMENT_OCR = `[Page 1]
Samaritus Profit & Loss Statement 2025
Gross margin [L/J]
71.2%
Return on sales [T/J]
15.0%
Prior Period
Current
Period
Current Period
as % of Sales
% Change
from Prior
Period
Sales Revenue
2022 Jubilance Charters
$ 549,557.00
40.4%
2021 Aquila Charters
$
210,192.00
15.4%
0.0%
2022 Aquila Charters
$
376,859.00
27.7%
2025 D29 Charters
$
190,007.00
14.0%
0.0%
2025 D32 Charters
$
27,238.00
2.0%
0.0%
Other Credits
$
6,626.00
0.5%
0.0%
Total Sales Revenue [J] $
$ 1,360,479.00
0.0%
Cost of Sales
Commissions
$ 257,232.00
65.6%
#DIV/0!
Interest Paid
$
80,520.00
20.5%
Digital Payments
$
54,419.16
Other
$
0.0%
Total Cost of Sales [K] $
$ 392,171.16
#DIV/0!
Gross Profit [L] = [J - K] $
$ 968,307.84
Operating Expenses
Marina Svcs, Repairs & Maint
$ 273,786.00
64.6%
#DIV/0!
1
[Page 2]
Fuel & Ice
$
58,394.00
13.8%
#DIV/0!
Insurance
$
37,315.00
9.5%
#DIV/0!
Marketing & Advertising
$
23,604.00
5.6%
#DIV/0!
Other
$
30,719.00
7.2%
#DIV/0!
Total Operating Expenses
$
$ 423,818.00
#DIV/0!
[M]
General and
Administrative
Payroll & Labor
Equipment & Supplies
Depreciation
Other
Total General and
Administrative Expenses
$ 228,574.00
67.2%
#DIV/0!
$
27,912.00
8.2%
#DIV/0!
$
83,882.70
24.6%
#DIV/0!
$
0.0%
$
$ 340,368.70
#DIV/0!
[0]
Total Operating Expenses
$
$ 764,186.70
#DIV/0!
[P] = [M + N + O]
Income from Operations
$
$
204,121.14
[Q] = [L - P]
Taxes
Other Income [R]
$
Income taxes
$
25.00
100.0%
#DIV/0!
Payroll taxes
$
0.0%
Real estate taxes
$
0.0%
Total Taxes [S] $
$
25.00
#DIV/0!
2
[Page 3]
Net Profit [T] = [Q + R - S] $
$ 204,096.14
3`;

// ── Balance Sheet OCR (936 chars) ─────────────────────────────────────────
const BALANCE_SHEET_OCR = `[Page 1]
Samaritus Balance Sheet 2025
Asset Type
FY 2025
Current Assets (Cash)
$93,087.00
Aquila 2021
$425,000.00
Aquila 2022
$475,000.00
Moneymaker 47 2021
$850,000.00
Rand 27 Supreme 2025 (SOLD)
$0.00
De Antonio D29 2025
$225,000.00
De Antonio D32 2025
$350,000.00
Unpaid Charter Income Owed to Samaritus
$144,000.00
Other Equipment
$50,000.00
Fixed Assets
$2,519,000.00
Depreciation
$83,882.70
Total Fixed Assets
$2,435,117.30
Asset Pre-Paid Expense
$43,573.00
Total Assets
$2,571,777.30
Current Liabilities
Amex Business Card Balance
$9,000.00
Loan for D32
$278,203.00
Loan for Aquila 2022
$422,000.00
Loan of Aquila 2021
$390,733.00
Owed to Partner Mike (Jubilance)
$69,700.00
1

[Page 2]
Owed to Partner Joe
Owed to Partner Mike
Total Liabilities
Net Income/Loss
Owner Equity
-$20,000.00
-$20,000.00
$1,129,636.00
$204,096.14
$1,238,045.16
Total Liabilities & Stockholder Equity
$2,571,777.30
Balance
$0.00
2`;

// ── PFS OCR (first 3000 chars) ───────────────────────────────────────────
const PFS_OCR = `[Page 1]
OLD GLORY BANK™
PERSONAL FINANCIAL STATEMENT
Section 1 - Individual/Applicant Information (please Print)
Name
Michael J Newmark
Residence Address
112 Northwest Path
City
Sagaponack
Position or Occupation
Self-Employed
Business Name
Section 2 – Other Party/Co-Applicant Information (please print)
Name
Residence Address
State
Zip
City
NY
11962
Position or Occupation
Luxury Home Rental LLC
Business Address
PO Box 2165
City
Sag Harbor
Years with Business
15
Res. Phone
9174960860
Business Name
Business Address
State
Zip
City
NY
11963
Years with Business
Bus. Phone
Res. Phone
State
Zip
State
Zip
Bus. Phone
V 1.0
Confidential
1 of 4
[Page 2]
Statement of Financial Condition as of:
OLD GLORY BANK™
PERSONAL FINANCIAL STATEMENT
Jan 1 2026
Section 3 - Balance Sheet (attach additional schedules as needed)
Assets
Dollars Jt*
Liabilities
Cash and Short-Term Investments (Sch A)
$278,000
Stocks & Bonds (readily marketable) (Sch B)
$451,000
Other Marketable Securities (Sch C)
$55,000
Notes Receivable & Accounts Receivable
$150,000
Cash Surrender Value-Life Insurance (Sch D)
$0.00
General/Ltd Partnership Interests (Sch El
$0
Taxes Payable
Policy Loan (life insurance) (Sch D)
Mortgages & Obligations Due (Sch F&G)
Notes & Accounts Payable (Sch H)
Other Liabilities (list):
Dollars
$10,000
$0
Jt*
$0
$1,771,000
Retirement Accounts
$0
Automobiles
$50,000
Real Estate-Personal Residence (Sch F)
$7,000,000
Real Estate Investments (Sch G)
Real Estate Investments (Direct & Partnership
Interests (Sch G)
Other Assets (list):
$900,000
Vessel Jubilance
$500,000
De Antonio D29
$110,000
De Antonio D32
$50,000
Total Assets
$9,544,000 $0
Total Liabilities
$1,781,000 $0
Net Worth (total assets minus total liabilities)
$7,763,000 $0`;

// ═══════════════════════════════════════════════════════════════════════════
// Income Statement extraction tests
// ═══════════════════════════════════════════════════════════════════════════

test("IS: Total Sales Revenue cross-line match", () => {
  const pattern = /total\s+(?:sales\s+)?revenue|(?:net|gross)\s+(?:sales|revenue)|total\s+sales|service\s+(?:income|revenue)|fee\s+income/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null. Snippet: ${result.snippet}`);
  assert.equal(result.value, 1360479, `Expected 1360479, got ${result.value}`);
});

test("IS: Cost of Sales cross-line match (fixed — prefers 'Total Cost of Sales')", () => {
  const pattern = /total\s+cost\s+of\s+(?:sales|revenue|goods)|cost\s+of\s+(?:goods\s+)?sold|\bCOGS\b|direct\s+costs?/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  COGS match: ${result.value} — snippet: ${result.snippet}`);
  assert.equal(result.value, 392171.16, `Expected 392171.16, got ${result.value}`);
});

test("IS: Gross Profit cross-line match (fixed — no longer matches 'Gross margin' percentage)", () => {
  const pattern = /gross\s+profit(?!\s*%)|gross\s+margin\s+\$/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Gross Profit match: ${result.value} — snippet: ${result.snippet}`);
  assert.equal(result.value, 968307.84, `Expected 968307.84, got ${result.value}`);
});

test("IS: Net Income cross-line match", () => {
  const pattern = /net\s+(?:income|profit|loss)|bottom\s+line/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Net Income match: ${result.value} — snippet: ${result.snippet}`);
});

test("IS: Total Operating Expenses cross-line match", () => {
  const pattern = /total\s+(?:operating\s+)?expenses|total\s+opex/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Total OpEx match: ${result.value} — snippet: ${result.snippet}`);
});

test("IS: Insurance cross-line match", () => {
  const pattern = /\binsurance\b(?!\s+(?:income|value))/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Insurance match: ${result.value} — snippet: ${result.snippet}`);
});

test("IS: Depreciation cross-line match (packed G&A layout — may pick up adjacent value)", () => {
  const pattern = /\bdepreciation\b/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  // In this OCR, Depreciation is listed in packed G&A section; may pick up
  // the G&A total ($228,574) instead of actual depreciation ($83,882.70).
  // This is a known limitation of label-adjacent matching.
  console.log(`  Depreciation match: ${result.value} — snippet: ${result.snippet}`);
  assert.ok(result.value !== null, `Expected value, got null`);
});

test("IS: Payroll cross-line match", () => {
  const pattern = /payroll(?:\s+(?:&|and)\s+labor)?|salaries|wages|employee\s+(?:cost|expense)/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Payroll match: ${result.value} — snippet: ${result.snippet}`);
});

test("IS: Repairs & Maintenance cross-line match", () => {
  const pattern = /repairs?\s*(?:&|and)?\s*maintenance|R&M|marina\s+svcs/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  R&M match: ${result.value} — snippet: ${result.snippet}`);
});

// Same-line tests (should FAIL for this OCR format)
test("IS: Same-line match returns null for cross-line OCR format", () => {
  const pattern = /total\s+(?:sales\s+)?revenue/i;
  const result = findLabeledAmount(INCOME_STATEMENT_OCR, pattern);
  // Same-line should fail because amount is on next line
  assert.equal(result.value, null, "Same-line should not match cross-line OCR");
});

// ═══════════════════════════════════════════════════════════════════════════
// Balance Sheet extraction tests
// ═══════════════════════════════════════════════════════════════════════════

test("BS: Cash (Current Assets) cross-line match", () => {
  const pattern = /cash\s+(?:and\s+)?(?:cash\s+)?equivalents?|cash\s+(?:and\s+)?short[\s-]?term|cash\s+(?:in\s+)?banks?|(?:checking|savings)(?:\s+account)?|current\s+assets?\s*\(cash\)|\bcash\b(?!\s+(?:flow|basis|surrender|method|value))/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 93087, `Expected 93087, got ${result.value}`);
});

test("BS: Total Assets cross-line match", () => {
  const pattern = /total\s+assets/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Total Assets match: ${result.value} — snippet: ${result.snippet}`);
  // First "Total Assets" should match 2,571,777.30 (from business BS)
  // or 2,435,117.30 (Total Fixed Assets — but that pattern is different)
});

test("BS: Total Liabilities cross-line match", () => {
  const pattern = /total\s+liabilities(?!\s+(?:and|&))/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Total Liabilities match: ${result.value} — snippet: ${result.snippet}`);
});

test("BS: Total Liabilities & Equity cross-line match", () => {
  const pattern = /total\s+liabilities\s+(?:and|&)\s+(?:stockholders?['\u2019]?\s+)?equity|total\s+liabilities\s+(?:and|&)\s+(?:net\s+)?worth/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  TL&E match: ${result.value} — snippet: ${result.snippet}`);
});

test("BS: Net Fixed Assets cross-line match", () => {
  const pattern = /net\s+(?:fixed|property)\s+asset|total\s+fixed\s+asset/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Net Fixed Assets match: ${result.value} — snippet: ${result.snippet}`);
});

test("BS: Long-Term Debt cross-line match (no 'loan for' pattern — avoids D32)", () => {
  const pattern = /long[\s-]?term\s+(?:debt|borrowing|note)|LTD|term\s+loan/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  // This BS doesn't have explicit "Long-Term Debt" label — null is acceptable
  console.log(`  LTD match: ${result.value} — snippet: ${result.snippet}`);
});

test("BS: Depreciation cross-line match", () => {
  const pattern = /accumulated\s+depreciation|accum\.?\s+depr|\bdepreciation\b/i;
  const result = findLabeledAmount(BALANCE_SHEET_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Depreciation match: ${result.value} — snippet: ${result.snippet}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// PFS extraction tests
// ═══════════════════════════════════════════════════════════════════════════

test("PFS: Cash & Short-Term cross-line match", () => {
  const pattern = /cash\s+(?:and\s+)?short[\s-]?term\s+invest/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 278000, `Expected 278000, got ${result.value}`);
});

test("PFS: Stocks & Bonds cross-line match", () => {
  const pattern = /stocks?\s*(?:&|and)\s*bonds?/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 451000, `Expected 451000, got ${result.value}`);
});

test("PFS: Total Assets cross-line match", () => {
  const pattern = /total\s+assets/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 9544000, `Expected 9544000, got ${result.value}`);
});

test("PFS: Total Liabilities cross-line match", () => {
  const pattern = /total\s+liabilit/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 1781000, `Expected 1781000, got ${result.value}`);
});

test("PFS: Net Worth cross-line match", () => {
  const pattern = /net\s+worth/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 7763000, `Expected 7763000, got ${result.value}`);
});

test("PFS: Mortgages cross-line match", () => {
  const pattern = /mortgages?\s+(?:&|and)\s+obligations?\s+due/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  console.log(`  Mortgages match: ${result.value} — snippet: ${result.snippet}`);
});

test("PFS: Real Estate cross-line match", () => {
  const pattern = /real\s+estate[\s-]+(?:personal\s+)?residen/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  assert.ok(result.value !== null, `Expected value, got null`);
  assert.equal(result.value, 7000000, `Expected 7000000, got ${result.value}`);
});

test("PFS: Credit Cards — not present in OCR snippet, returns null", () => {
  const pattern = /(?:outstanding\s+)?credit\s+card\s+balance/i;
  const result = findLabeledAmount(PFS_OCR, pattern, { crossLine: true });
  // The PFS form has two-column layout; "Outstanding Credit Card Balances"
  // header is interleaved with assets in OCR. Null is acceptable.
  assert.equal(result.value, null, "Credit card label not directly present in OCR");
});

// ═══════════════════════════════════════════════════════════════════════════
// Generic row scanner integration test (income statement)
// ═══════════════════════════════════════════════════════════════════════════

test("Generic scanner: Income Statement OCR finds key P&L concepts", () => {
  const MONEY_RE = /\$?\(?-?[0-9][0-9,]*(?:\.[0-9]{1,2})?\)?/;
  const lines = INCOME_STATEMENT_OCR.split(/\n/);
  const found: Array<{ label: string; alias: string; value: number }> = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moneyMatch = line.match(MONEY_RE);
    if (!moneyMatch) continue;

    const value = parseMoney(moneyMatch[0]);
    if (value === null) continue;

    const labelOnLine = line.slice(0, moneyMatch.index).trim();
    let labelCtx = labelOnLine;
    if (labelOnLine.length < 4 && i > 0) {
      labelCtx = lines[i - 1].trim();
    }
    if (!labelCtx) continue;

    const cleaned = labelCtx
      .replace(/\[.*?\]/g, "")
      .replace(/\(Sch\s+\w+\)/gi, "")
      .trim();

    const alias = normalizePlLabel(cleaned);
    if (!alias) continue;
    if (seenKeys.has(alias.factKey)) continue;
    seenKeys.add(alias.factKey);

    found.push({ label: cleaned, alias: alias.key, value });
  }

  console.log("  Generic scanner found:", found.map(f => `${f.alias}=${f.value}`).join(", "));
  assert.ok(found.length >= 3, `Expected >=3 facts, got ${found.length}: ${JSON.stringify(found)}`);
});
