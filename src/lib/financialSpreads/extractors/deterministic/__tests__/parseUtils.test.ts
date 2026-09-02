import test from "node:test";
import assert from "node:assert/strict";

// parseUtils is pure (no "server-only") — import directly
import {
  isLikelyReferenceNumber,
  looksLikeMoneyToken,
  findLabeledAmount,
  parseMoney,
  normalizeLabelPatternSource,
  findInterimPeriodHeader,
  findDateInFilename,
  findDateOnDocument,
  resolveDocDate,
  matchAmountAfterLabel,
} from "../parseUtils";

// ── isLikelyReferenceNumber ───────────────────────────────────────────────

test("isLikelyReferenceNumber: 1040 near 'Form' context", () => {
  assert.equal(isLikelyReferenceNumber(1040, "Form 1040 for tax year 2023"), true);
});

test("isLikelyReferenceNumber: 1065 near 'Schedule' context", () => {
  assert.equal(isLikelyReferenceNumber(1065, "See Schedule K-1 (Form 1065)"), true);
});

test("isLikelyReferenceNumber: 1120 near 'IRS' context", () => {
  assert.equal(isLikelyReferenceNumber(1120, "IRS Form 1120 Corporation Return"), true);
});

test("isLikelyReferenceNumber: 4562 depreciation form", () => {
  assert.equal(isLikelyReferenceNumber(4562, "Form 4562 Depreciation"), true);
});

test("isLikelyReferenceNumber: 8825 rental form", () => {
  assert.equal(isLikelyReferenceNumber(8825, "See Form 8825 attached"), true);
});

test("isLikelyReferenceNumber: 1040 without IRS context is not a reference", () => {
  assert.equal(isLikelyReferenceNumber(1040, "Total revenue was 1040 for the period"), false);
});

test("isLikelyReferenceNumber: non-form number is not a reference", () => {
  assert.equal(isLikelyReferenceNumber(5000, "Form 5000 something"), false);
});

test("isLikelyReferenceNumber: 45000 is not in the set", () => {
  assert.equal(isLikelyReferenceNumber(45000, "Form reference 45000"), false);
});

// ── looksLikeMoneyToken ──────────────────────────────────────────────────

test("looksLikeMoneyToken: $ prefix", () => {
  assert.equal(looksLikeMoneyToken("$1040"), true);
});

test("looksLikeMoneyToken: comma-separated", () => {
  assert.equal(looksLikeMoneyToken("1,040"), true);
});

test("looksLikeMoneyToken: parenthetical negative", () => {
  assert.equal(looksLikeMoneyToken("(1065)"), true);
});

test("looksLikeMoneyToken: decimal", () => {
  assert.equal(looksLikeMoneyToken("1040.00"), true);
});

test("looksLikeMoneyToken: 5+ digit number", () => {
  assert.equal(looksLikeMoneyToken("10400"), true);
});

test("looksLikeMoneyToken: bare 4-digit number is NOT money-like", () => {
  assert.equal(looksLikeMoneyToken("1040"), false);
});

test("looksLikeMoneyToken: bare 4-digit number 1065", () => {
  assert.equal(looksLikeMoneyToken("1065"), false);
});

// ── findLabeledAmount with IRS guard ─────────────────────────────────────

test("findLabeledAmount: rejects Form 1065 number as dollar amount", () => {
  // When the label is "gross receipts" and the captured number is 1065 near "Form 1065"
  const text = "Form 1065 gross receipts 1065 partnership";
  const result = findLabeledAmount(text, /gross\s+receipts/i);
  // "1065" after "gross receipts" — context includes "Form" so guard triggers
  if (result.value !== null) {
    assert.notEqual(result.value, 1065, "Should not return 1065 as a dollar value");
  }
});

test("findLabeledAmount: allows $1,040 (money-formatted)", () => {
  const text = "Total expenses: $1,040.00";
  const result = findLabeledAmount(text, /total\s+expenses/i);
  assert.equal(result.value, 1040, "$1,040.00 is a valid money amount");
});

test("findLabeledAmount: allows 1065 when no IRS context nearby", () => {
  const text = "rent collected: 1065 per month";
  const result = findLabeledAmount(text, /rent\s+collected/i);
  assert.equal(result.value, 1065);
});

test("findLabeledAmount: allows real dollar amounts after form-number labels", () => {
  const text = "line 1a gross receipts $125,000";
  const result = findLabeledAmount(text, /line\s+1[abc]?/i);
  assert.equal(result.value, 125000);
});

test("findLabeledAmount: rejects bare 4562 near 'Form' context", () => {
  const text = "See Form 4562 depreciation amount 4562";
  const result = findLabeledAmount(text, /depreciation\s+amount/i);
  if (result.value !== null) {
    assert.notEqual(result.value, 4562);
  }
});

// ── parseMoney sanity checks ─────────────────────────────────────────────

test("parseMoney: standard money", () => {
  assert.equal(parseMoney("$125,000.00"), 125000);
});

test("parseMoney: parenthetical negative", () => {
  assert.equal(parseMoney("(5,000)"), -5000);
});

test("parseMoney: plain number", () => {
  assert.equal(parseMoney("1040"), 1040);
});

// ── SPEC-EXTRACTION-LABEL-AMOUNT-INTEGRITY-1 ─────────────────────────────
// Label patterns that carry their OWN trailing amount capture used to make the
// outer amount group backtrack onto the last digit (325,810 → 32581) or pick
// the IRS line number that precedes the amount ("line 1c | 3 | 997,082" → 3).

const AMOUNT_CAPTURE = /(?:line\s+9|total\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i;

test("findLabeledAmount: label with embedded amount capture keeps every digit", () => {
  const r = findLabeledAmount("|  Total income | 325,810  |", AMOUNT_CAPTURE);
  assert.equal(r.value, 325810);
  assert.equal(r.raw, "325,810");
});

test("findLabeledAmount: prefers the money-looking token over a preceding line number", () => {
  const r = findLabeledAmount(
    "Net sales line 1c | 3 | 997,082",
    /(?:line\s+1c|net\s+(?:sales|receipts)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i,
  );
  assert.equal(r.value, 997082);
});

test("findLabeledAmount: six-digit amounts survive (863,403 not 86340)", () => {
  const r = findLabeledAmount(
    "|  Total deductions | 863,403  |",
    /(?:line\s+27|total\s+deductions).*?(\$?[\d,]+(?:\.\d{0,2})?)/i,
  );
  assert.equal(r.value, 863403);
});

test("findLabeledAmount: OCR column with line number before amount", () => {
  const r = findLabeledAmount(
    "Salaries and wages (less employment credits) | 8 | 418,019",
    /(?:line\s+13|salaries\s+(?:and\s+)?wages).*?(\$?[\d,]+(?:\.\d{0,2})?)/i,
  );
  assert.equal(r.value, 418019);
});

test("findLabeledAmount: trailing schedule reference after the amount is ignored", () => {
  const r = findLabeledAmount(
    "Net income (loss) per books | 106,319 | 5",
    /(?:net\s+income|net\s+profit).*?(\$?[\d,]+(?:\.\d{0,2})?)/i,
  );
  assert.equal(r.value, 106319);
});

test("findLabeledAmount: plain label without capture still picks the first token", () => {
  const r = findLabeledAmount("Cost of labor | 312", /cost\s+of\s+labor/i);
  assert.equal(r.value, 312);
  assert.equal(r.raw, "312");
});

test("findLabeledAmount: a bare 1–2 digit token beside a label is a line/box number, not an amount", () => {
  // K-1 box with no value: the box number is the only numeric token.
  const blank = findLabeledAmount("|  Net rental real estate income (loss) | 2 |   |", /net\s+rental\s+real\s+estate/i);
  assert.equal(blank.value, null);
  // Zero is still a real amount.
  const zero = findLabeledAmount("|  Total S Corporation taxes | 0  |", /total s corporation taxes/i);
  assert.equal(zero.value, 0);
  // Opt-in for callers whose values legitimately are small counts.
  const counted = findLabeledAmount("Cost of labor | 3", /cost\s+of\s+labor/i, { allowSmallIntegers: true });
  assert.equal(counted.value, 3);
  // Money-formatted small amounts are never rejected.
  const money = findLabeledAmount("Bank charges | $12", /bank\s+charges/i);
  assert.equal(money.value, 12);
});

test("matchAmountAfterLabel: 1120-S row with the line number before and after the label", () => {
  const row = "|   |  13 Interest (see instructions) | 13 | 1,004  |\n| Interest income | 163 |";
  const pat = /(?:line\s+13\b|(?:^|\|)\s*(?:13\s+)?interest\s*(?:\(see\s+instructions\))?\s*\|).*?(\$?[\d,]+(?:\.\d{0,2})?)/im;
  const m = matchAmountAfterLabel(row, pat);
  assert.ok(m);
  assert.equal(m[1], "1,004");
});

test("findLabeledAmount: percent column does not shadow the dollar column", () => {
  const r = findLabeledAmount("|  Services | $ 684,399.71 | 100.00  |", /\bservices\b/i);
  assert.equal(r.value, 684399.71);
});

test("normalizeLabelPatternSource: strips trailing amount capture and de-captures groups", () => {
  const src = normalizeLabelPatternSource(
    /(?:line\s+(?:8|12)|business\s+income|schedule\s+C\s+(?:net|income)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i.source,
  );
  assert.equal(src, "(?:line\\s+(?:8|12)|business\\s+income|schedule\\s+C\\s+(?:net|income))");
  const textCapture = normalizeLabelPatternSource(/(?:filing\s+status)\s*(single|married)/i.source);
  assert.equal(textCapture, "(?:filing\\s+status)\\s*(?:single|married)");
});

// ── Interim period headers / filename dates ───────────────────────────────

test("findInterimPeriodHeader: six months ended → ISO range", () => {
  assert.equal(
    findInterimPeriodHeader("# Buff Guys\n\n## Income Statement\n\nFor the six months ended June 30, 2026\n"),
    "2026-01-01 to 2026-06-30",
  );
});

test("findInterimPeriodHeader: numeric months + US date", () => {
  assert.equal(findInterimPeriodHeader("For the 3 months ending 3/31/2026"), "2026-01-01 to 2026-03-31");
});

test("findInterimPeriodHeader: year ended → full year range", () => {
  assert.equal(findInterimPeriodHeader("For the year ended December 31, 2025"), "2025-01-01 to 2025-12-31");
});

test("findInterimPeriodHeader: period ended without a month count → end date only", () => {
  assert.equal(findInterimPeriodHeader("For the period ended September 30, 2025"), "2025-09-30");
});

test("findInterimPeriodHeader: no header → null", () => {
  assert.equal(findInterimPeriodHeader("Total income 325,810"), null);
});

test("findDateOnDocument: standalone header date on a balance sheet", () => {
  assert.equal(findDateOnDocument("# Buff Guys\n\n## Balance Sheet\n\nJune 30, 2026\n\n| Assets |"), "2026-06-30");
});

test("findDateInFilename: M-D-YYYY, M.D.YYYY and YYYY-MM-DD forms", () => {
  assert.equal(findDateInFilename("IS 6-30-2026 Atlanta Ceramic.pdf"), "2026-06-30");
  assert.equal(findDateInFilename("BS_12.31.2025.pdf"), "2025-12-31");
  assert.equal(findDateInFilename("pl-2026-03-31-draft.xlsx"), "2026-03-31");
  assert.equal(findDateInFilename("BTR 2025 ATLCC.pdf"), null);
  assert.equal(findDateInFilename(null), null);
});

test("resolveDocDate: filename date beats the doc-year fallback", () => {
  assert.equal(resolveDocDate("no dates here", 2026, { originalFilename: "IS 6-30-2026.pdf" }), "2026-06-30");
  assert.equal(resolveDocDate("no dates here", 2026), "2026");
});

// ── matchAmountAfterLabel (schedule extractors) ──────────────────────────

test("matchAmountAfterLabel: line number between label and amount is skipped", () => {
  const m = matchAmountAfterLabel(
    "Distributions (attach statement if required) | **16 | 12,500",
    /(?:box\s+(?:16[d]?|19[a]?)\b|(?:cash\s+)?distributions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i,
  );
  assert.ok(m);
  assert.equal(m![1], "12,500");
  assert.equal(parseMoney(m![1]), 12500);
});

test("matchAmountAfterLabel: `[:\\s]*(amount)` shaped pattern still resolves", () => {
  const m = matchAmountAfterLabel(
    "Amount of compensation: $185,000",
    /(?:amount\s+of\s+compensation|compensation)[:\s]*(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i,
  );
  assert.ok(m);
  assert.equal(parseMoney(m![1]), 185000);
});

test("matchAmountAfterLabel: no amount → null", () => {
  assert.equal(matchAmountAfterLabel("Beginning capital account", /beginning\s+capital\s+account.*?(\(?-?\$?\d[\d,]*)/i), null);
});

test("normalizeLabelPatternSource: strips `[:\\s]*(numeric)` tails too", () => {
  assert.equal(
    normalizeLabelPatternSource(/(?:amount\s+of\s+compensation|compensation)[:\s]*(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i.source),
    "(?:amount\\s+of\\s+compensation|compensation)",
  );
});

test("findLabeledAmount: Form 8990 reference is not an interest amount", () => {
  const text = "Does the corporation have business interest expense. If \"Yes,\" complete and attach Form 8990, | 12";
  const r = findLabeledAmount(text, /interest\s+(?:expense|paid|deduction)/i);
  assert.notEqual(r.value, 8990);
});
