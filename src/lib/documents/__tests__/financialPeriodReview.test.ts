/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-1 — Detection helper tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  needsFinancialPeriodReview,
  getFinancialPeriodReviewReason,
  GENERIC_FINANCIAL_CHECKLIST_KEYS,
  RESOLVED_FINANCIAL_CHECKLIST_KEYS,
} from "../financialPeriodReview";

describe("needsFinancialPeriodReview", () => {
  // ── Balance Sheet ──────────────────────────────────────────────────────

  it("BALANCE_SHEET + checklist_key BALANCE_SHEET => needs review", () => {
    assert.ok(needsFinancialPeriodReview({
      canonicalType: "BALANCE_SHEET",
      checklistKey: "BALANCE_SHEET",
      statementPeriod: null,
    }));
  });

  it("BALANCE_SHEET + null checklist_key => needs review", () => {
    assert.ok(needsFinancialPeriodReview({
      canonicalType: "BALANCE_SHEET",
      checklistKey: null,
      statementPeriod: null,
    }));
  });

  it("BALANCE_SHEET + FIN_STMT_BS_CURRENT => no review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "BALANCE_SHEET",
      checklistKey: "FIN_STMT_BS_CURRENT",
      statementPeriod: "CURRENT",
    }));
  });

  it("BALANCE_SHEET + FIN_STMT_BS_HISTORICAL => no review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "BALANCE_SHEET",
      checklistKey: "FIN_STMT_BS_HISTORICAL",
      statementPeriod: "HISTORICAL",
    }));
  });

  // ── Income Statement ───────────────────────────────────────────────────

  it("INCOME_STATEMENT + null checklist_key => needs review", () => {
    assert.ok(needsFinancialPeriodReview({
      canonicalType: "INCOME_STATEMENT",
      checklistKey: null,
      statementPeriod: null,
    }));
  });

  it("INCOME_STATEMENT + INCOME_STATEMENT (generic) => needs review", () => {
    assert.ok(needsFinancialPeriodReview({
      canonicalType: "INCOME_STATEMENT",
      checklistKey: "INCOME_STATEMENT",
      statementPeriod: null,
    }));
  });

  it("INCOME_STATEMENT + FIN_STMT_PL_YTD => no review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "INCOME_STATEMENT",
      checklistKey: "FIN_STMT_PL_YTD",
      statementPeriod: "YTD",
    }));
  });

  it("INCOME_STATEMENT + FIN_STMT_PL_ANNUAL => no review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "INCOME_STATEMENT",
      checklistKey: "FIN_STMT_PL_ANNUAL",
      statementPeriod: "ANNUAL",
    }));
  });

  // ── Generic Financial Statement ────────────────────────────────────────

  it("FINANCIAL_STATEMENT generic => needs review", () => {
    assert.ok(needsFinancialPeriodReview({
      canonicalType: "FINANCIAL_STATEMENT",
      checklistKey: "FINANCIAL_STATEMENT",
      statementPeriod: null,
    }));
  });

  // ── Non-financial types ────────────────────────────────────────────────

  it("AR_AGING => does not need financial period review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "AR_AGING",
      checklistKey: "AR_AGING",
      statementPeriod: null,
    }));
  });

  it("BUSINESS_TAX_RETURN => does not need financial period review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: "BUSINESS_TAX_RETURN",
      checklistKey: "IRS_BUSINESS_2025",
      statementPeriod: null,
    }));
  });

  it("null canonical type => does not need review", () => {
    assert.ok(!needsFinancialPeriodReview({
      canonicalType: null,
      checklistKey: null,
      statementPeriod: null,
    }));
  });
});

describe("getFinancialPeriodReviewReason", () => {
  it("returns reason string for unresolved balance sheet", () => {
    const reason = getFinancialPeriodReviewReason({
      canonicalType: "BALANCE_SHEET",
      checklistKey: null,
      statementPeriod: null,
    });
    assert.ok(reason);
    assert.ok(reason.includes("CURRENT or HISTORICAL"));
  });

  it("returns reason string for unresolved income statement", () => {
    const reason = getFinancialPeriodReviewReason({
      canonicalType: "INCOME_STATEMENT",
      checklistKey: null,
      statementPeriod: null,
    });
    assert.ok(reason);
    assert.ok(reason.includes("YTD or ANNUAL"));
  });

  it("returns null for resolved balance sheet", () => {
    assert.equal(getFinancialPeriodReviewReason({
      canonicalType: "BALANCE_SHEET",
      checklistKey: "FIN_STMT_BS_CURRENT",
      statementPeriod: "CURRENT",
    }), null);
  });
});

// ── Readiness hardening ──────────────────────────────────────────────────────

describe("readiness: generic keys must not satisfy checklist slots", () => {
  it("raw BALANCE_SHEET key is in GENERIC set (does not satisfy readiness)", () => {
    assert.ok(GENERIC_FINANCIAL_CHECKLIST_KEYS.has("BALANCE_SHEET"));
  });

  it("raw INCOME_STATEMENT key is in GENERIC set (does not satisfy readiness)", () => {
    assert.ok(GENERIC_FINANCIAL_CHECKLIST_KEYS.has("INCOME_STATEMENT"));
  });

  it("raw FINANCIAL_STATEMENT key is in GENERIC set", () => {
    assert.ok(GENERIC_FINANCIAL_CHECKLIST_KEYS.has("FINANCIAL_STATEMENT"));
  });

  it("FIN_STMT_BS_CURRENT is in RESOLVED set (does satisfy readiness)", () => {
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_BS_CURRENT"));
  });

  it("FIN_STMT_BS_HISTORICAL is in RESOLVED set (does satisfy readiness)", () => {
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_BS_HISTORICAL"));
  });

  it("FIN_STMT_PL_YTD is in RESOLVED set (does satisfy readiness)", () => {
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_PL_YTD"));
  });

  it("FIN_STMT_PL_ANNUAL is in RESOLVED set (does satisfy readiness)", () => {
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_PL_ANNUAL"));
  });
});

describe("checklist engine accepts resolved period keys", () => {
  // Source-pattern guard: the checklist engine must recognize resolved period keys
  const engineSrc = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "src/lib/checklist/engine.ts"),
    "utf-8",
  );

  it("FIN_STMT_BS_CURRENT is in acceptableDocTypesForChecklistKey", () => {
    assert.ok(engineSrc.includes("FIN_STMT_BS_CURRENT"));
  });

  it("FIN_STMT_BS_HISTORICAL is in acceptableDocTypesForChecklistKey", () => {
    assert.ok(engineSrc.includes("FIN_STMT_BS_HISTORICAL"));
  });

  it("FIN_STMT_PL_ANNUAL is in acceptableDocTypesForChecklistKey", () => {
    assert.ok(engineSrc.includes("FIN_STMT_PL_ANNUAL"));
  });
});

describe("checklist key sets", () => {
  it("generic keys do not overlap with resolved keys", () => {
    for (const key of GENERIC_FINANCIAL_CHECKLIST_KEYS) {
      assert.ok(!RESOLVED_FINANCIAL_CHECKLIST_KEYS.has(key),
        `${key} appears in both generic and resolved sets`);
    }
  });

  it("resolved keys cover all four expected slots", () => {
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_BS_CURRENT"));
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_BS_HISTORICAL"));
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_PL_YTD"));
    assert.ok(RESOLVED_FINANCIAL_CHECKLIST_KEYS.has("FIN_STMT_PL_ANNUAL"));
  });
});
