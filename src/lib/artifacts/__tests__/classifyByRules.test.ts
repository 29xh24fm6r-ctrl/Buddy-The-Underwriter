import test from "node:test";
import assert from "node:assert/strict";
import { classifyByRules } from "../classifyByRules";

// ---------------------------------------------------------------------------
// Form anchor tests (Tier 1 — high confidence)
// ---------------------------------------------------------------------------

test("classifyByRules: Form 1040 text → IRS_PERSONAL", () => {
  const result = classifyByRules(
    "Department of the Treasury—Internal Revenue Service\nForm 1040\nU.S. Individual Income Tax Return\nFor the Year 2023",
    "upload.pdf",
  );
  assert.ok(result, "Should produce a result");
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.ok(result.confidence >= 0.90, `confidence ${result.confidence} should be >= 0.90`);
  assert.equal(result.tier, "rules_form");
  assert.equal(result.entityType, "personal");
  assert.ok(result.formNumbers?.includes("1040"), "Should include 1040 in formNumbers");
  assert.equal(result.taxYear, 2023);
});

test("classifyByRules: Form 1120S text → IRS_BUSINESS", () => {
  const result = classifyByRules(
    "Form 1120S\nU.S. Income Tax Return for an S Corporation\nFor calendar year 2022",
    "tax-return.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "IRS_BUSINESS");
  assert.ok(result.confidence >= 0.90);
  assert.equal(result.tier, "rules_form");
  assert.equal(result.entityType, "business");
  assert.ok(result.formNumbers?.includes("1120S"));
});

test("classifyByRules: Form 1065 text → IRS_BUSINESS with tax year", () => {
  const result = classifyByRules(
    "Form 1065\nU.S. Return of Partnership Income\nFor calendar year 2023, or tax year beginning...",
    "partnership.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "IRS_BUSINESS");
  assert.equal(result.taxYear, 2023);
  assert.ok(result.formNumbers?.includes("1065"));
});

test("classifyByRules: Schedule K-1 → K1", () => {
  const result = classifyByRules(
    "Schedule K-1 (Form 1065)\nPartner's Share of Income, Deductions, Credits, etc.\nTax Year 2022",
    "k1.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "K1");
  assert.ok(result.confidence >= 0.90);
  assert.equal(result.tier, "rules_form");
});

test("classifyByRules: Form W-2 → W2", () => {
  const result = classifyByRules(
    "Form W-2 Wage and Tax Statement 2023\nEmployer: Acme Corp",
    "w2.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "W2");
  assert.equal(result.entityType, "personal");
});

test("classifyByRules: Form 1099 → 1099", () => {
  const result = classifyByRules(
    "Form 1099-MISC\nMiscellaneous Income\nPayer: Smith LLC",
    "1099.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "1099");
  assert.equal(result.entityType, "personal");
});

// ---------------------------------------------------------------------------
// Keyword anchor tests (Tier 2 — medium confidence)
// ---------------------------------------------------------------------------

test("classifyByRules: 'Rent Roll' keyword → RENT_ROLL", () => {
  const result = classifyByRules(
    "Sunset Apartments\nRent Roll as of January 1, 2024\nUnit 101, John Smith, $1,250/mo",
    "report.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "RENT_ROLL");
  assert.ok(result.confidence >= 0.70);
  assert.equal(result.tier, "rules_keyword");
});

test("classifyByRules: 'Operating Statement' keyword → T12", () => {
  const result = classifyByRules(
    "OPERATING STATEMENT\nFor the Period: January 2023 - December 2023\nGross Rental Income: $540,000",
    "statement.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "T12");
  assert.ok(result.confidence >= 0.70);
  assert.equal(result.tier, "rules_keyword");
});

test("classifyByRules: 'Trailing 12' keyword → T12", () => {
  const result = classifyByRules(
    "Trailing 12 Month Income and Expense Report\nProperty: Oak Grove Apartments",
    "t12.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "T12");
});

test("classifyByRules: 'Personal Financial Statement' → PFS", () => {
  const result = classifyByRules(
    "PERSONAL FINANCIAL STATEMENT\nAs of December 31, 2023\nAssets:\nCash: $50,000",
    "pfs.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "PFS");
  assert.ok(result.confidence >= 0.70);
  assert.equal(result.tier, "rules_keyword");
  assert.equal(result.entityType, "personal");
});

test("classifyByRules: 'Articles of Incorporation' → ARTICLES", () => {
  const result = classifyByRules(
    "ARTICLES OF INCORPORATION\nOf ABC Holdings LLC\nFiled with the Secretary of State",
    "articles.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "ARTICLES");
  assert.equal(result.entityType, "business");
});

test("classifyByRules: 'Certificate of Insurance' → INSURANCE", () => {
  const result = classifyByRules(
    "CERTIFICATE OF INSURANCE\nThis certificate is issued as a matter of information only",
    "coi.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "INSURANCE");
});

test("classifyByRules: 'Phase 1 Environmental' → ENVIRONMENTAL", () => {
  const result = classifyByRules(
    "Phase 1 Environmental Site Assessment\nPrepared for: ABC Bank\nProperty: 123 Main St",
    "esa.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "ENVIRONMENTAL");
});

test("classifyByRules: 'Bank Statement' → BANK_STATEMENT", () => {
  const result = classifyByRules(
    "Chase Bank Statement\nAccount: *1234\nStatement Period: January 1 - January 31, 2024",
    "statement.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "BANK_STATEMENT");
});

// ---------------------------------------------------------------------------
// Filename anchor tests (Tier 3 — low confidence)
// ---------------------------------------------------------------------------

test("classifyByRules: filename '2023_1040.pdf' → IRS_PERSONAL", () => {
  const result = classifyByRules(
    "Some generic text content that doesn't contain IRS form identifiers",
    "2023_1040.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.ok(result.confidence >= 0.60, `confidence ${result.confidence} should be >= 0.60`);
  assert.equal(result.tier, "rules_filename");
});

test("classifyByRules: filename 'rent-roll-2024.xlsx' → RENT_ROLL", () => {
  const result = classifyByRules(
    "Column A, Column B, Column C",
    "rent-roll-2024.xlsx",
  );
  assert.ok(result);
  assert.equal(result.docType, "RENT_ROLL");
  assert.equal(result.tier, "rules_filename");
});

// ---------------------------------------------------------------------------
// No-match test
// ---------------------------------------------------------------------------

test("classifyByRules: gibberish text + neutral filename → null", () => {
  const result = classifyByRules(
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.",
    "document.pdf",
  );
  assert.equal(result, null, "Should return null when no rules match");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("classifyByRules: Form 1120 (not 1120S) → IRS_BUSINESS", () => {
  const result = classifyByRules(
    "Form 1120\nU.S. Corporation Income Tax Return\nFor calendar year 2023",
    "corp-return.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "IRS_BUSINESS");
  assert.ok(result.formNumbers?.includes("1120"));
});

test("classifyByRules: empty text but filename has '1040' → uses filename", () => {
  const result = classifyByRules("", "client_1040_2023.pdf");
  assert.ok(result);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.tier, "rules_filename");
});

test("classifyByRules: form anchor takes priority over keyword anchor", () => {
  // Text has both "Form 1040" (form anchor) and "rent roll" (keyword)
  const result = classifyByRules(
    "Form 1040\nThis form includes a rent roll schedule",
    "mixed.pdf",
  );
  assert.ok(result);
  assert.equal(result.docType, "IRS_PERSONAL");
  assert.equal(result.tier, "rules_form");
});

test("classifyByRules: tax year extraction from 'December 31, 2023'", () => {
  const result = classifyByRules(
    "Form 1040\nDecember 31, 2023\nU.S. Individual Income Tax Return",
    "return.pdf",
  );
  assert.ok(result);
  assert.equal(result.taxYear, 2023);
});
