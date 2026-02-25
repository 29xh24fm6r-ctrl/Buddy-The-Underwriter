/**
 * D1-D3: Validation Gate + Evidence + Consistency Guard Tests
 *
 * CI guards for:
 * - D1: Validation gate function exists and works
 * - D2: Evidence capture types
 * - D3: Consistency checks (BS balance, IS gross_profit, year mismatch)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateBalanceSheet,
  validateIncomeStatement,
  validateTaxReturn,
  validateYearConsistency,
  runValidationGate,
  BS_BALANCE_TOLERANCE,
  IS_GP_TOLERANCE,
  type FactForValidation,
} from "../../spreads/preflight/validateExtractedFinancials";

import {
  computeDeterministicConfidence,
  hashSnippet,
  buildFactEvidence,
} from "../evidence";

// ── D1: Validation Gate ──────────────────────────────────────────────

describe("D1: Validation Gate", () => {
  it("runValidationGate returns PASSED for valid BS facts", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TOTAL_ASSETS", fact_value_num: 1000, fact_value_text: null, fact_type: "BS" },
      { fact_key: "TOTAL_LIABILITIES", fact_value_num: 600, fact_value_text: null, fact_type: "BS" },
      { fact_key: "NET_WORTH", fact_value_num: 400, fact_value_text: null, fact_type: "BS" },
    ];

    const gate = runValidationGate({ docType: "BALANCE_SHEET", facts });
    assert.equal(gate.result.status, "PASSED");
  });

  it("runValidationGate returns SUSPECT for imbalanced BS", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TOTAL_ASSETS", fact_value_num: 1000, fact_value_text: null, fact_type: "BS" },
      { fact_key: "TOTAL_LIABILITIES", fact_value_num: 600, fact_value_text: null, fact_type: "BS" },
      { fact_key: "NET_WORTH", fact_value_num: 200, fact_value_text: null, fact_type: "BS" },
    ];

    const gate = runValidationGate({ docType: "BALANCE_SHEET", facts });
    assert.equal(gate.result.status, "SUSPECT");
    assert.equal(gate.result.reason_code, "BS_IMBALANCE");
  });

  it("runValidationGate includes all checks in result", () => {
    const facts: FactForValidation[] = [
      { fact_key: "REVENUE", fact_value_num: 500, fact_value_text: null, fact_type: "IS" },
    ];

    const gate = runValidationGate({ docType: "INCOME_STATEMENT", facts, expectedYear: 2023 });
    assert.ok(gate.checks.length >= 1);
    assert.ok(gate.checks.some((c) => c.check === "type_validation"));
  });

  it("runValidationGate catches year mismatch", () => {
    const facts: FactForValidation[] = [
      { fact_key: "REVENUE", fact_value_num: 500, fact_value_text: null, fact_type: "IS" },
      { fact_key: "TAX_YEAR", fact_value_num: 2022, fact_value_text: null, fact_type: "META" },
    ];

    const gate = runValidationGate({ docType: "INCOME_STATEMENT", facts, expectedYear: 2023 });
    assert.equal(gate.result.status, "SUSPECT");
    assert.equal(gate.result.reason_code, "YEAR_MISMATCH");
  });
});

// ── D2: Evidence Capture ─────────────────────────────────────────────

describe("D2: Evidence Capture", () => {
  it("computeDeterministicConfidence returns 0.95 when both sources agree", () => {
    const conf = computeDeterministicConfidence({
      fromStructured: true,
      fromOcrRegex: true,
      anchorCount: 2,
      valuesAgree: true,
    });
    assert.equal(conf, 0.95);
  });

  it("computeDeterministicConfidence returns 0.60 when both sources disagree", () => {
    const conf = computeDeterministicConfidence({
      fromStructured: true,
      fromOcrRegex: true,
      anchorCount: 2,
      valuesAgree: false,
    });
    assert.equal(conf, 0.60);
  });

  it("computeDeterministicConfidence returns 0.85 for structured-only", () => {
    const conf = computeDeterministicConfidence({
      fromStructured: true,
      fromOcrRegex: false,
      anchorCount: 1,
    });
    assert.equal(conf, 0.85);
  });

  it("computeDeterministicConfidence returns 0.80 for regex with 2+ anchors", () => {
    const conf = computeDeterministicConfidence({
      fromStructured: false,
      fromOcrRegex: true,
      anchorCount: 2,
    });
    assert.equal(conf, 0.80);
  });

  it("hashSnippet returns null for empty input", () => {
    assert.equal(hashSnippet(null), null);
    assert.equal(hashSnippet(""), null);
    assert.equal(hashSnippet("  "), null);
  });

  it("hashSnippet returns deterministic hash", () => {
    const h1 = hashSnippet("Revenue: $1,234,567");
    const h2 = hashSnippet("Revenue: $1,234,567");
    assert.ok(h1);
    assert.equal(h1, h2);
    assert.equal(h1!.length, 16); // Truncated to 16 chars
  });

  it("buildFactEvidence creates well-formed evidence", () => {
    const ev = buildFactEvidence({
      source: "structured",
      matchedText: "Total Revenue: 500000",
      anchorIds: ["entity:total_revenue"],
      deterministicConfidence: 0.85,
    });

    assert.equal(ev.source, "structured");
    assert.ok(ev.matched_text_hash);
    assert.equal(ev.deterministic_confidence, 0.85);
    assert.deepEqual(ev.anchor_ids, ["entity:total_revenue"]);
  });
});

// ── D3: Consistency Checks ───────────────────────────────────────────

describe("D3: Consistency Checks", () => {
  it("BS_BALANCE_TOLERANCE is 5%", () => {
    assert.equal(BS_BALANCE_TOLERANCE, 0.05);
  });

  it("IS_GP_TOLERANCE is 5%", () => {
    assert.equal(IS_GP_TOLERANCE, 0.05);
  });

  it("BS: A = L + E within tolerance passes", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TOTAL_ASSETS", fact_value_num: 1000, fact_value_text: null, fact_type: "BS" },
      { fact_key: "TOTAL_LIABILITIES", fact_value_num: 600, fact_value_text: null, fact_type: "BS" },
      { fact_key: "NET_WORTH", fact_value_num: 398, fact_value_text: null, fact_type: "BS" },
    ];
    const result = validateBalanceSheet(facts);
    assert.equal(result.status, "PASSED");
  });

  it("BS: A != L + E beyond tolerance fails", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TOTAL_ASSETS", fact_value_num: 1000, fact_value_text: null, fact_type: "BS" },
      { fact_key: "TOTAL_LIABILITIES", fact_value_num: 300, fact_value_text: null, fact_type: "BS" },
      { fact_key: "NET_WORTH", fact_value_num: 300, fact_value_text: null, fact_type: "BS" },
    ];
    const result = validateBalanceSheet(facts);
    assert.equal(result.status, "SUSPECT");
    assert.equal(result.reason_code, "BS_IMBALANCE");
  });

  it("IS: gross_profit = revenue - COGS within tolerance passes", () => {
    const facts: FactForValidation[] = [
      { fact_key: "REVENUE", fact_value_num: 1000, fact_value_text: null, fact_type: "IS" },
      { fact_key: "COGS", fact_value_num: 400, fact_value_text: null, fact_type: "IS" },
      { fact_key: "GROSS_PROFIT", fact_value_num: 599, fact_value_text: null, fact_type: "IS" },
    ];
    const result = validateIncomeStatement(facts);
    assert.equal(result.status, "PASSED");
  });

  it("IS: gross_profit != revenue - COGS beyond tolerance fails", () => {
    const facts: FactForValidation[] = [
      { fact_key: "REVENUE", fact_value_num: 1000, fact_value_text: null, fact_type: "IS" },
      { fact_key: "COGS", fact_value_num: 400, fact_value_text: null, fact_type: "IS" },
      { fact_key: "GROSS_PROFIT", fact_value_num: 200, fact_value_text: null, fact_type: "IS" },
    ];
    const result = validateIncomeStatement(facts);
    assert.equal(result.status, "SUSPECT");
    assert.equal(result.reason_code, "IS_GP_INCONSISTENCY");
  });

  it("year mismatch detection works", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TAX_YEAR", fact_value_num: 2022, fact_value_text: null, fact_type: "META" },
    ];
    const result = validateYearConsistency(facts, 2023);
    assert.equal(result.status, "SUSPECT");
    assert.equal(result.reason_code, "YEAR_MISMATCH");
  });

  it("year match passes", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TAX_YEAR", fact_value_num: 2023, fact_value_text: null, fact_type: "META" },
    ];
    const result = validateYearConsistency(facts, 2023);
    assert.equal(result.status, "PASSED");
  });

  it("no extracted year → PASSED (don't block on missing data)", () => {
    const facts: FactForValidation[] = [];
    const result = validateYearConsistency(facts, 2023);
    assert.equal(result.status, "PASSED");
  });

  it("no expected year → PASSED", () => {
    const facts: FactForValidation[] = [
      { fact_key: "TAX_YEAR", fact_value_num: 2022, fact_value_text: null, fact_type: "META" },
    ];
    const result = validateYearConsistency(facts, null);
    assert.equal(result.status, "PASSED");
  });
});
