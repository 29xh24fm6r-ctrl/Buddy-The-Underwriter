import { test } from "node:test";
import assert from "node:assert/strict";

import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";
import { RULESETS } from "@/lib/checklist/rules";
import type { ChecklistRuleSet } from "@/lib/checklist/types";

// Pure helper - avoid importing from engine.ts which has server-only dependencies
function normalizeLoanType(raw: string | null | undefined): string {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "UNKNOWN";
  if (v.includes("CRE") && v.includes("OWNER")) return "CRE_OWNER_OCCUPIED";
  if (v.includes("CRE") && v.includes("INVESTOR")) return "CRE_INVESTOR";
  return v.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

function getRuleSetForLoanType(loanTypeRaw: string | null | undefined): ChecklistRuleSet | null {
  const norm = normalizeLoanType(loanTypeRaw);
  return RULESETS.find((r) => r.loan_type_norm === norm) || null;
}

// ========================================
// Test Fixtures
// ========================================

interface MatcherFixture {
  filename: string;
  expectedKey: string;
  minConfidence: number;
}

const MATCHER_FIXTURES: MatcherFixture[] = [
  // Tax Returns - Form Numbers
  { filename: "1040_John_Smith_2024.pdf", expectedKey: "IRS_PERSONAL_3Y", minConfidence: 0.85 },
  { filename: "1120S_Business_2023.pdf", expectedKey: "IRS_BUSINESS_3Y", minConfidence: 0.85 },
  { filename: "1065_Partnership_2024.pdf", expectedKey: "IRS_BUSINESS_3Y", minConfidence: 0.85 },
  { filename: "Form 1040 2024.pdf", expectedKey: "IRS_PERSONAL_3Y", minConfidence: 0.75 },

  // Tax Returns - Abbreviations
  { filename: "PTR_2024.pdf", expectedKey: "IRS_PERSONAL_3Y", minConfidence: 0.85 },
  { filename: "BTR_2024.pdf", expectedKey: "IRS_BUSINESS_3Y", minConfidence: 0.85 },
  { filename: "Personal Tax Return 2024.pdf", expectedKey: "IRS_PERSONAL_3Y", minConfidence: 0.75 },
  { filename: "Business Tax Return 2023.pdf", expectedKey: "IRS_BUSINESS_3Y", minConfidence: 0.75 },

  // Personal Financial Statement
  { filename: "PFS_2024.pdf", expectedKey: "PFS_CURRENT", minConfidence: 0.85 },
  { filename: "Personal Financial Statement.pdf", expectedKey: "PFS_CURRENT", minConfidence: 0.8 },
  { filename: "SBA Form 413.pdf", expectedKey: "PFS_CURRENT", minConfidence: 0.75 },

  // Financial Statements
  { filename: "P&L Statement YTD 2024.xlsx", expectedKey: "FIN_STMT_PL_YTD", minConfidence: 0.8 },
  { filename: "Balance Sheet Dec 2024.pdf", expectedKey: "FIN_STMT_BS_YTD", minConfidence: 0.8 },
  { filename: "Income Statement 2024.pdf", expectedKey: "FIN_STMT_PL_YTD", minConfidence: 0.8 },

  // Real Estate Documents
  { filename: "Rent Roll January 2025.pdf", expectedKey: "RENT_ROLL", minConfidence: 0.85 },
  { filename: "T-12 Operating Statement.pdf", expectedKey: "PROPERTY_T12", minConfidence: 0.8 },
  { filename: "Bank Statement Chase Dec 2024.pdf", expectedKey: "BANK_STMT_3M", minConfidence: 0.65 },
];

const NO_MATCH_FIXTURES = [
  "random_notes.txt",
  "photo_vacation.jpg",
  "contract_draft_v2.docx",
  "meeting_minutes_jan.pdf",
];

const REQUIRED_UNIVERSAL_KEYS = [
  "IRS_BUSINESS_3Y",
  "IRS_PERSONAL_3Y",
  "PFS_CURRENT",
  "FIN_STMT_PL_YTD",
  "FIN_STMT_BS_YTD",
];

const FORBIDDEN_LEGACY_KEYS = [
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BALANCE_SHEET",
  "INCOME_STATEMENT",
];

// ========================================
// Filename Matching Tests
// ========================================

test("matchChecklistKeyFromFilename matches expected files", () => {
  for (const fixture of MATCHER_FIXTURES) {
    const result = matchChecklistKeyFromFilename(fixture.filename);
    assert.equal(
      result.matchedKey,
      fixture.expectedKey,
      `${fixture.filename} should match ${fixture.expectedKey}, got ${result.matchedKey}`
    );
    assert.ok(
      result.confidence >= fixture.minConfidence,
      `${fixture.filename} confidence ${result.confidence} should be >= ${fixture.minConfidence}`
    );
  }
});

test("matchChecklistKeyFromFilename does NOT match random files", () => {
  for (const filename of NO_MATCH_FIXTURES) {
    const result = matchChecklistKeyFromFilename(filename);
    if (result.matchedKey) {
      assert.ok(
        result.confidence < 0.6,
        `${filename} matched ${result.matchedKey} with confidence ${result.confidence}, expected < 0.6`
      );
    } else {
      assert.equal(result.matchedKey, null);
    }
  }
});

test("matchChecklistKeyFromFilename handles empty and null strings gracefully", () => {
  assert.doesNotThrow(() => matchChecklistKeyFromFilename(""));
  assert.doesNotThrow(() => matchChecklistKeyFromFilename(null as unknown as string));
  assert.doesNotThrow(() => matchChecklistKeyFromFilename(undefined as unknown as string));
  // Note: Non-string values like numbers will throw - this is expected behavior
});

// ========================================
// Year Extraction Tests
// ========================================

test("extractYears extracts year from underscore-separated filename", () => {
  const result = matchChecklistKeyFromFilename("PFS_2024.pdf");
  assert.ok(result.yearsFound?.includes(2024), "Should find year 2024");
  assert.equal(result.docYear, 2024);
});

test("extractYears extracts year from space-separated filename", () => {
  const result = matchChecklistKeyFromFilename("Balance Sheet 2024.pdf");
  assert.ok(result.yearsFound?.includes(2024), "Should find year 2024");
});

test("extractYears extracts multiple years when properly separated", () => {
  // Use space-separated years - the regex boundary handling works best with distinct separators
  const result = matchChecklistKeyFromFilename("Tax Returns 2022 and 2023 and 2024.pdf");
  assert.ok(result.yearsFound?.includes(2022), "Should find 2022");
  assert.ok(result.yearsFound?.includes(2023), "Should find 2023");
  assert.ok(result.yearsFound?.includes(2024), "Should find 2024");
  assert.equal(result.yearsFound?.length, 3);
});

test("extractYears returns most recent year as docYear", () => {
  // Use space-separated years for reliable extraction
  const result = matchChecklistKeyFromFilename("Returns for 2020 2021 2022.pdf");
  assert.equal(result.docYear, 2022, "Most recent year should be docYear");
});

test("extractYears returns null docYear when no years found", () => {
  const result = matchChecklistKeyFromFilename("Personal Financial Statement.pdf");
  assert.equal(result.docYear, null);
  assert.deepEqual(result.yearsFound, []);
});

// ========================================
// Confidence Boosting Tests
// ========================================

test("confidence boosted when year is present for tax returns", () => {
  const withYear = matchChecklistKeyFromFilename("1040_2024.pdf");
  const withoutYear = matchChecklistKeyFromFilename("Form 1040.pdf");

  assert.ok(
    withYear.confidence > withoutYear.confidence,
    `With year (${withYear.confidence}) should have higher confidence than without (${withoutYear.confidence})`
  );
});

test("confidence boosted when year is present for financial statements", () => {
  const withYear = matchChecklistKeyFromFilename("Balance Sheet 2024.pdf");
  const withoutYear = matchChecklistKeyFromFilename("Balance Sheet.pdf");

  assert.ok(
    withYear.confidence > withoutYear.confidence,
    `With year (${withYear.confidence}) should have higher confidence than without (${withoutYear.confidence})`
  );
});

// ========================================
// Ruleset Tests
// ========================================

test("universal ruleset exists and is returned for UNKNOWN loan type", () => {
  const rs = getRuleSetForLoanType("UNKNOWN");
  assert.notEqual(rs, null);
  assert.equal(rs?.key, "UNIVERSAL_V1");
});

test("universal ruleset contains all required canonical keys", () => {
  const rs = getRuleSetForLoanType("UNKNOWN");
  assert.notEqual(rs, null);

  const keys = rs!.items.map((item) => item.checklist_key);

  for (const requiredKey of REQUIRED_UNIVERSAL_KEYS) {
    assert.ok(keys.includes(requiredKey), `Universal ruleset should contain ${requiredKey}`);
  }
});

test("universal ruleset has at least 5 required items", () => {
  const rs = getRuleSetForLoanType("UNKNOWN");
  const requiredItems = rs!.items.filter((item) => item.required);
  assert.ok(requiredItems.length >= 5, `Should have >= 5 required items, has ${requiredItems.length}`);
});

test("no ruleset contains legacy keys", () => {
  for (const ruleset of RULESETS) {
    const keys = ruleset.items.map((item) => item.checklist_key);

    for (const forbiddenKey of FORBIDDEN_LEGACY_KEYS) {
      assert.ok(!keys.includes(forbiddenKey), `${ruleset.key} should not contain legacy key ${forbiddenKey}`);
    }
  }
});

test("all rulesets have unique checklist keys", () => {
  for (const ruleset of RULESETS) {
    const keys = ruleset.items.map((item) => item.checklist_key);
    const uniqueKeys = new Set(keys);
    assert.equal(uniqueKeys.size, keys.length, `${ruleset.key} has duplicate checklist keys`);
  }
});

test("all ruleset items have title and description", () => {
  for (const ruleset of RULESETS) {
    for (const item of ruleset.items) {
      assert.ok(item.title && typeof item.title === "string", `${ruleset.key}.${item.checklist_key} missing title`);
      assert.ok(item.description && typeof item.description === "string", `${ruleset.key}.${item.checklist_key} missing description`);
    }
  }
});

test("CRE_OWNER_OCCUPIED ruleset exists", () => {
  const rs = getRuleSetForLoanType("CRE_OWNER_OCCUPIED");
  assert.notEqual(rs, null);
  assert.equal(rs?.loan_type_norm, "CRE_OWNER_OCCUPIED");
});

test("CRE_INVESTOR ruleset exists and has rent roll required", () => {
  const rs = getRuleSetForLoanType("CRE_INVESTOR");
  assert.notEqual(rs, null);

  const rentRoll = rs!.items.find((item) => item.checklist_key === "RENT_ROLL");
  assert.notEqual(rentRoll, undefined);
  assert.equal(rentRoll?.required, true);
});

// ========================================
// Integration Tests
// ========================================

test("uploaded PFS matches to seeded PFS_CURRENT item", () => {
  const match = matchChecklistKeyFromFilename("PFS_2024.pdf");
  assert.equal(match.matchedKey, "PFS_CURRENT");
  assert.ok(match.confidence >= 0.6);

  const rs = getRuleSetForLoanType("UNKNOWN");
  const pfsItem = rs!.items.find((item) => item.checklist_key === "PFS_CURRENT");
  assert.notEqual(pfsItem, undefined);
  assert.equal(pfsItem?.required, true);
});

test("uploaded 1040 matches to seeded IRS_PERSONAL_3Y item", () => {
  const match = matchChecklistKeyFromFilename("1040_John_2024.pdf");
  assert.equal(match.matchedKey, "IRS_PERSONAL_3Y");

  const rs = getRuleSetForLoanType("UNKNOWN");
  const taxItem = rs!.items.find((item) => item.checklist_key === "IRS_PERSONAL_3Y");
  assert.notEqual(taxItem, undefined);
});

test("uploaded 1120S matches to seeded IRS_BUSINESS_3Y item", () => {
  const match = matchChecklistKeyFromFilename("1120S_Business_2023.pdf");
  assert.equal(match.matchedKey, "IRS_BUSINESS_3Y");

  const rs = getRuleSetForLoanType("UNKNOWN");
  const taxItem = rs!.items.find((item) => item.checklist_key === "IRS_BUSINESS_3Y");
  assert.notEqual(taxItem, undefined);
});
