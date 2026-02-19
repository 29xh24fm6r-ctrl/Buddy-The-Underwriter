import test from "node:test";
import assert from "node:assert/strict";
import { runTier1Anchors, _ANCHOR_RULES_FOR_TESTING } from "../tier1Anchors";
import { normalizeDocument } from "../normalizeDocument";
import fs from "node:fs";
import path from "node:path";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeDoc(text: string, filename = "test.pdf") {
  return normalizeDocument("test-art", text, filename, "application/pdf");
}

// ─── IRS Form Anchors ───────────────────────────────────────────────────────

test("Tier 1: Form 1040 → IRS_PERSONAL with confidence ≥ 0.90", () => {
  const result = runTier1Anchors(makeDoc("Form 1040\nU.S. Individual Income Tax Return\nTax Year 2023"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.ok(result.confidence >= 0.90);
  assert.equal(result.anchorId, "IRS_1040_FORM_HEADER");
  assert.ok(result.evidence.length > 0);
  assert.equal(result.entityType, "personal");
});

test("Tier 1: 'U.S. Individual Income Tax Return' title → IRS_PERSONAL", () => {
  const result = runTier1Anchors(makeDoc("U.S. Individual Income Tax Return\nJohn Smith"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.anchorId, "IRS_1040_TITLE");
});

test("Tier 1: Form 1120S → IRS_BUSINESS", () => {
  const result = runTier1Anchors(makeDoc("Form 1120S\nU.S. Income Tax Return for S Corporation\nTax Year 2022"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_BUSINESS");
  assert.equal(result.entityType, "business");
});

test("Tier 1: Form 1120 → IRS_BUSINESS", () => {
  const result = runTier1Anchors(makeDoc("Form 1120\nU.S. Corporation Income Tax Return"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_BUSINESS");
});

test("Tier 1: Form 1065 → IRS_BUSINESS", () => {
  const result = runTier1Anchors(makeDoc("Form 1065\nU.S. Return of Partnership Income\nTax Year 2023"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_BUSINESS");
});

test("Tier 1: Schedule K-1 → K1 (not 1065)", () => {
  const result = runTier1Anchors(makeDoc("Schedule K-1 (Form 1065)\nPartner's Share of Income"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "K1");
  assert.equal(result.anchorId, "K1_SCHEDULE_HEADER");
});

test("Tier 1: Form W-2 → W2", () => {
  const result = runTier1Anchors(makeDoc("Form W-2\nWage and Tax Statement\n2023"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "W2");
});

test("Tier 1: Form 1099 → 1099", () => {
  const result = runTier1Anchors(makeDoc("Form 1099-INT\nInterest Income\n2023"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "1099");
});

// ─── Structural Anchors ─────────────────────────────────────────────────────

test("Tier 1: Balance Sheet with Total Assets + Total Liabilities → BALANCE_SHEET", () => {
  const text = "Balance Sheet\nAs of December 31, 2023\n\nTotal Assets: $1,500,000\nTotal Liabilities: $800,000\nEquity: $700,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "BALANCE_SHEET");
  assert.equal(result.anchorId, "BALANCE_SHEET_STRUCTURAL");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: Balance Sheet without Total Assets → NO match (secondary pattern required)", () => {
  const text = "Balance Sheet\nAs of December 31, 2023\nCash: $50,000\nEquipment: $100,000";
  const result = runTier1Anchors(makeDoc(text));
  // Should NOT match because "Total Assets" and "Total Liabilities" are missing
  assert.equal(result.matched, false);
});

test("Tier 1: Income Statement with revenue + expenses + net income → INCOME_STATEMENT", () => {
  const text = "Income Statement\nFor the Year Ended 2023\n\nTotal Revenue: $500,000\nTotal Expenses: $350,000\nNet Income: $150,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
  assert.equal(result.anchorId, "INCOME_STMT_STRUCTURAL");
});

test("Tier 1: Income Statement with only 1 of 3 secondary signals → NO match", () => {
  const text = "Income Statement\nFor the Year Ended 2023\n\nTotal Revenue: $500,000\nSome other data";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, false);
});

test("Tier 1: Bank Statement with beginning + ending balance → BANK_STATEMENT", () => {
  const text = "Account Statement\nBeginning Balance: $10,000\n01/02 Deposit $500\n01/05 Withdrawal $200\nEnding Balance: $10,300";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "BANK_STATEMENT");
  assert.equal(result.anchorId, "BANK_STMT_STRUCTURAL");
});

// ─── No match ───────────────────────────────────────────────────────────────

test("Tier 1: plain text with no anchors → no match", () => {
  const result = runTier1Anchors(makeDoc("This is a lease agreement for commercial property at 123 Main St."));
  assert.equal(result.matched, false);
  assert.equal(result.docType, null);
  assert.equal(result.anchorId, null);
  assert.equal(result.evidence.length, 0);
});

// ─── Tax year extraction ────────────────────────────────────────────────────

test("Tier 1: extracts tax year from IRS form text", () => {
  const result = runTier1Anchors(makeDoc("Form 1040\nTax Year 2023"));
  assert.equal(result.taxYear, 2023);
});

test("Tier 1: form number extraction populates formNumbers", () => {
  const result = runTier1Anchors(makeDoc("Form 1040\nSchedule C\nSchedule E"));
  assert.ok(result.formNumbers);
  assert.ok(result.formNumbers!.includes("1040"));
  assert.ok(result.formNumbers!.includes("Schedule C"));
});

// ─── Evidence always populated ──────────────────────────────────────────────

test("Tier 1: evidence array is populated when matched", () => {
  const result = runTier1Anchors(makeDoc("Form 1120S\nS Corporation Return"));
  assert.ok(result.matched);
  assert.ok(result.evidence.length >= 1);
  assert.equal(result.evidence[0].type, "form_match");
  assert.equal(result.evidence[0].anchorId, "IRS_1120S_FORM_HEADER");
  assert.ok(result.evidence[0].matchedText.length > 0);
  assert.ok(result.evidence[0].confidence >= 0.90);
});

// ─── Confidence ranges ──────────────────────────────────────────────────────

test("Tier 1: all anchor rule confidences are 0.90–0.99", () => {
  for (const rule of _ANCHOR_RULES_FOR_TESTING) {
    assert.ok(
      rule.confidence >= 0.90 && rule.confidence <= 0.99,
      `Anchor ${rule.anchorId} confidence ${rule.confidence} outside 0.90-0.99`,
    );
  }
});

// ─── Priority: Form 1040 wins over structural keyword ───────────────────────

test("Tier 1: Form 1040 in text with balance sheet keywords → IRS_PERSONAL wins", () => {
  const text = "Form 1040\nBalance Sheet\nTotal Assets: $100,000\nTotal Liabilities: $50,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  // K-1 is checked first, but doesn't match. Form 1040 matches before Balance Sheet structural.
  assert.equal(result.docType, "IRS_PERSONAL");
});

// ─── NO T12 INVARIANT (critical) ───────────────────────────────────────────

test("Tier 1: NO anchor rule maps to T12", () => {
  for (const rule of _ANCHOR_RULES_FOR_TESTING) {
    assert.notEqual(
      rule.docType,
      "T12",
      `Anchor ${rule.anchorId} maps to T12 — this is a Buddy invariant violation`,
    );
  }
});

test("Tier 1: source file does not contain T12 in anchor definitions", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/classification/tier1Anchors.ts"),
    "utf8",
  );
  // Extract the anchor arrays only (between FORM_ANCHORS/STRUCTURAL_ANCHORS and their closing brackets)
  const formSection = src.slice(
    src.indexOf("const FORM_ANCHORS"),
    src.indexOf("const STRUCTURAL_ANCHORS"),
  );
  const structSection = src.slice(
    src.indexOf("const STRUCTURAL_ANCHORS"),
    src.indexOf("const PRIORITY_SORTED_ANCHORS"),
  );
  const anchorsSource = formSection + structSection;

  assert.ok(
    !anchorsSource.includes('"T12"'),
    "Tier 1 anchor definitions must not contain T12 doc type",
  );
  assert.ok(
    !/trailing\s*12|trailing\s*twelve/i.test(anchorsSource),
    "Tier 1 anchor definitions must not reference 'Trailing 12' or 'Trailing Twelve'",
  );
});

// ─── Structural anchor: "Profit and Loss" also matches ──────────────────────

test("Tier 1: 'Profit and Loss' with secondary signals → INCOME_STATEMENT", () => {
  const text = "Profit and Loss\nFor the Year Ended 2023\n\nSales: $500,000\nOperating Expenses: $350,000\nNet Profit: $150,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
});

test("Tier 1: 'Profit & Loss' alternate format → INCOME_STATEMENT", () => {
  const text = "Profit & Loss Statement\n\nRevenue: $500,000\nExpenses: $350,000\nNet Income: $150,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
});

// ─── v2.1 additions ──────────────────────────────────────────────────────────

test("Tier 1: Form 1040-SR → IRS_PERSONAL (senior return)", () => {
  const result = runTier1Anchors(makeDoc("Form 1040-SR\nU.S. Tax Return for Seniors\nTax Year 2024"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.anchorId, "IRS_1040SR_FORM_HEADER");
  assert.equal(result.entityType, "personal");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: Form 1040SR (no hyphen) → IRS_PERSONAL", () => {
  const result = runTier1Anchors(makeDoc("Form 1040SR\nTax Year 2024"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.anchorId, "IRS_1040SR_FORM_HEADER");
});

test("Tier 1: regular Form 1040 still works after 1040-SR addition (regression)", () => {
  const result = runTier1Anchors(makeDoc("Form 1040\nU.S. Individual Income Tax Return\nTax Year 2023"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.anchorId, "IRS_1040_FORM_HEADER");
  assert.equal(result.confidence, 0.97);
});

test("Tier 1: Form 4506-C → TAX_TRANSCRIPT_REQUEST", () => {
  const result = runTier1Anchors(makeDoc("Form 4506-C\nIVRS Request for Transcript of Tax Return"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "TAX_TRANSCRIPT_REQUEST");
  assert.equal(result.anchorId, "IRS_4506_FORM_HEADER");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: Form 4506-T → TAX_TRANSCRIPT_REQUEST", () => {
  const result = runTier1Anchors(makeDoc("Form 4506-T\nRequest for Transcript of Tax Return"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "TAX_TRANSCRIPT_REQUEST");
  assert.equal(result.anchorId, "IRS_4506_FORM_HEADER");
});

test("Tier 1: Form 8821 → TAX_AUTH", () => {
  const result = runTier1Anchors(makeDoc("Form 8821\nTax Information Authorization\nDepartment of the Treasury"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "TAX_AUTH");
  assert.equal(result.anchorId, "IRS_8821_FORM_HEADER");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: Form 2848 → TAX_AUTH", () => {
  const result = runTier1Anchors(makeDoc("Form 2848\nPower of Attorney and Declaration of Representative"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "TAX_AUTH");
  assert.equal(result.anchorId, "IRS_2848_FORM_HEADER");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: SBA Form 1919 → SBA_APPLICATION", () => {
  const result = runTier1Anchors(makeDoc("SBA Form 1919\nBorrower Information Form\nU.S. Small Business Administration"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "SBA_APPLICATION");
  assert.equal(result.anchorId, "SBA_1919_FORM_HEADER");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: SBA Form 413 → PERSONAL_FINANCIAL_STATEMENT (overrides Tier 2 PFS)", () => {
  const result = runTier1Anchors(makeDoc("SBA Form 413\nPersonal Financial Statement\nAssets\nLiabilities\nNet Worth"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "PERSONAL_FINANCIAL_STATEMENT");
  assert.equal(result.anchorId, "SBA_413_FORM_HEADER");
  assert.equal(result.entityType, "personal");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: ACORD 25 → INSURANCE", () => {
  const result = runTier1Anchors(makeDoc("ACORD 25\nCertificate of Liability Insurance\nDate: 01/15/2024"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INSURANCE");
  assert.equal(result.anchorId, "ACORD_INSURANCE_CERT");
  assert.ok(result.confidence >= 0.90);
});

test("Tier 1: ACORD 27 → INSURANCE", () => {
  const result = runTier1Anchors(makeDoc("ACORD 27\nEvidence of Property Insurance"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INSURANCE");
});

test("Tier 1: ACORD 28 → INSURANCE", () => {
  const result = runTier1Anchors(makeDoc("ACORD 28\nEvidence of Commercial Property Insurance"));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INSURANCE");
});

test("Tier 1: 'Statement of Operations' + revenue + expenses → INCOME_STATEMENT", () => {
  const text = "Statement of Operations\nFor the Year Ended December 31, 2024\n\nTotal Revenue: $750,000\nOperating Expenses: $480,000\nNet Income: $270,000";
  const result = runTier1Anchors(makeDoc(text));
  assert.equal(result.matched, true);
  assert.equal(result.docType, "INCOME_STATEMENT");
  assert.equal(result.anchorId, "INCOME_STMT_STRUCTURAL");
});
