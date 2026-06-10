import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveColumnSourceAttribution,
  buildSpreadColumns,
  type SpreadColumnFact,
} from "../canonicalSpreadViewModel";
import type { ReconcileFact } from "@/lib/financialFacts/reconcileFinancialFacts";

/**
 * SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1 — source attribution comes from the actual
 * facts used in each column, never from the date.
 */

function cf(over: Partial<ReconcileFact & SpreadColumnFact>): ReconcileFact & SpreadColumnFact {
  return {
    id: Math.random().toString(36).slice(2),
    fact_key: "GROSS_RECEIPTS",
    fact_value_num: 1000000,
    fact_period_start: null,
    fact_period_end: "2024-12-31",
    owner_type: "DEAL",
    owner_entity_id: null,
    source_document_id: "doc-x",
    source_canonical_type: "BUSINESS_TAX_RETURN",
    confidence: 0.9,
    extractor: "gemini_primary_v1",
    ...over,
  };
}

describe("audit method from actual facts (not date)", () => {
  it("2023 tax-return column → Audit Method = Tax Return", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_period_end: "2023-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" })],
      "2023-12-31",
    );
    assert.equal(col?.auditMethod, "Tax Return");
    assert.equal(col?.statementType, "Annual");
  });

  it("2024 tax-return column → Audit Method = Tax Return", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_period_end: "2024-12-31", source_canonical_type: "PERSONAL_TAX_RETURN" })],
      "2024-12-31",
    );
    assert.equal(col?.auditMethod, "Tax Return");
  });

  it("2025 company-prepared full-year column → Company Prepared", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_period_end: "2025-12-31", fact_period_start: "2025-01-01", source_canonical_type: "FINANCIAL_STATEMENT" })],
      "2025-12-31",
    );
    assert.equal(col?.auditMethod, "Company Prepared");
    assert.equal(col?.monthsCovered, 12);
  });

  it("3/31/2026 → Interim / 3 months", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_period_end: "2026-03-31", fact_period_start: "2026-01-01", source_canonical_type: "INCOME_STATEMENT" })],
      "2026-03-31",
    );
    assert.equal(col?.auditMethod, "Interim");
    assert.equal(col?.statementType, "Interim");
    assert.equal(col?.monthsCovered, 3);
  });

  it("empty 4/28/2026 column is suppressed (null facts)", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_period_end: "2026-04-28", fact_value_num: null, source_canonical_type: "FINANCIAL_STATEMENT" })],
      "2026-04-28",
    );
    assert.equal(col, null);
  });

  it("mixed tax + company period → Mixed Sources", () => {
    const col = deriveColumnSourceAttribution(
      [
        cf({ fact_key: "GROSS_RECEIPTS", fact_period_end: "2024-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
        cf({ fact_key: "NET_INCOME", fact_period_end: "2024-12-31", source_canonical_type: "FINANCIAL_STATEMENT" }),
      ],
      "2024-12-31",
    );
    assert.equal(col?.auditMethod, "Mixed Sources");
  });

  it("computed-only column → Computed", () => {
    const col = deriveColumnSourceAttribution(
      [cf({ fact_key: "EBITDA", fact_period_end: "2024-12-31", source_canonical_type: null, extractor: "computeBusinessEbitdaFacts:v2" })],
      "2024-12-31",
    );
    assert.equal(col?.auditMethod, "Computed");
  });
});

describe("buildSpreadColumns — reconciliation + empty suppression + GCF gate", () => {
  it("suppresses empty columns and excludes reconciliation-rejected personal facts", () => {
    const vm = buildSpreadColumns([
      cf({ fact_key: "GROSS_RECEIPTS", fact_period_end: "2024-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
      // bad personal facts (excluded from spreads + block GCF)
      cf({ fact_key: "WAGES_W2", fact_value_num: 310134, owner_type: "PERSONAL", owner_entity_id: "o1", source_canonical_type: "PERSONAL_TAX_RETURN", extractor: "personalIncomeExtractor:v2:deterministic", confidence: 1, fact_period_end: "2024-12-31" }),
      cf({ fact_key: "WAGES_W2", fact_value_num: 3, owner_type: "PERSONAL", owner_entity_id: "o1", source_canonical_type: "PERSONAL_TAX_RETURN", extractor: "gemini_primary_v1", confidence: 0.8, fact_period_end: "2024-12-31" }),
      cf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0, owner_type: "PERSONAL", owner_entity_id: "o1", fact_period_end: "2024-12-31" }),
    ]);
    // WAGES_W2=3 rejected; AGI=0 with material wages → personal blocked → GCF preliminary.
    assert.ok(vm.rejectedFacts.some((f) => f.fact_key === "WAGES_W2" && f.fact_value_num === 3));
    assert.equal(vm.gcfPreliminary, true);
    // business column present + attributed Tax Return
    assert.equal(vm.columns.length, 1);
    assert.equal(vm.columns[0].auditMethod, "Tax Return");
  });

  it("clean personal facts → GCF not preliminary", () => {
    const vm = buildSpreadColumns([
      cf({ fact_key: "WAGES_W2", fact_value_num: 310134, owner_type: "PERSONAL", owner_entity_id: "o1", confidence: 1, fact_period_end: "2024-12-31" }),
      cf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 340000, owner_type: "PERSONAL", owner_entity_id: "o1", confidence: 1, fact_period_end: "2024-12-31" }),
    ]);
    assert.equal(vm.gcfPreliminary, false);
  });
});
