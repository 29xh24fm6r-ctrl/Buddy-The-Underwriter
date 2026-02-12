/**
 * Phase 3 — Renderer Migration Tests
 *
 * Tests:
 * 1. V1 adapter: RenderedSpread → SpreadViewModel
 * 2. V2 adapter: FinancialModel → SpreadViewModel
 * 3. Diff utility: diffSpreadViewModels
 * 4. Determinism: same input → same output
 * 5. Layout contract: section/row counts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderFromLegacySpread } from "../renderer/v1Adapter";
import { renderFromFinancialModel } from "../renderer/v2Adapter";
import { diffSpreadViewModels } from "../renderer/viewModelDiff";
import type { RenderedSpread } from "@/lib/financialSpreads/types";
import type { FinancialModel } from "../types";
import type { SpreadViewModel } from "../renderer/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEAL_ID = "render-migration-test";

/** Minimal RenderedSpread (schema v3) with 2 sections, 3 rows */
const LEGACY_SPREAD: RenderedSpread = {
  schema_version: 3,
  title: "Moody's Financial Analysis",
  spread_type: "MOODYS",
  status: "ready",
  generatedAt: "2024-12-01T00:00:00Z",
  columns: ["Dec 2024"],
  columnsV2: [
    { key: "2024-12-31", label: "Dec 2024", kind: "other" },
  ],
  rows: [
    // Section header
    { key: "_header_BALANCE_SHEET", label: "Balance Sheet", values: [], notes: "section_header" },
    // Data row: CASH_AND_EQUIVALENTS = 500,000
    {
      key: "CASH_AND_EQUIVALENTS",
      label: "Cash & Cash Equivalents",
      section: "Current Assets",
      values: [{
        value: 500000,
        valueByCol: { "2024-12-31": 500000 },
        displayByCol: { "2024-12-31": "500,000" },
      }],
    },
    // Data row: TOTAL_ASSETS = 5,000,000
    {
      key: "TOTAL_ASSETS",
      label: "Total Assets",
      section: "Total Assets",
      values: [{
        value: 5000000,
        valueByCol: { "2024-12-31": 5000000 },
        displayByCol: { "2024-12-31": "5,000,000" },
        formula_ref: "TOTAL_ASSETS",
      }],
      formula: "TOTAL_ASSETS",
    },
    // Section header
    { key: "_header_INCOME_STATEMENT", label: "Income Statement", values: [], notes: "section_header" },
    // Data row: TOTAL_REVENUE (with string value to test parsing)
    {
      key: "TOTAL_REVENUE",
      label: "Total Revenue",
      section: "Revenue",
      values: [{
        value: 1000000,
        valueByCol: { "2024-12-31": "1000000" },
        displayByCol: { "2024-12-31": "1,000,000" },
      }],
    },
  ],
};

/** Minimal FinancialModel with 1 period */
const MODEL: FinancialModel = {
  dealId: DEAL_ID,
  periods: [
    {
      periodId: `${DEAL_ID}:2024-12-31`,
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 1000000, cogs: 400000, operatingExpenses: 200000, netIncome: 300000 },
      balance: { cash: 500000, totalAssets: 5000000, totalLiabilities: 3000000, equity: 2000000 },
      cashflow: { ebitda: 400000 },
      qualityFlags: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. V1 adapter contract tests
// ---------------------------------------------------------------------------

describe("V1 adapter: renderFromLegacySpread", () => {
  it("produces valid SpreadViewModel from RenderedSpread", () => {
    const vm = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    assert.equal(vm.source, "v1_legacy");
    assert.equal(vm.dealId, DEAL_ID);
    assert.equal(typeof vm.generatedAt, "string");
    assert.ok(vm.columns.length > 0);
    assert.ok(vm.sections.length > 0);
    assert.ok(vm.meta.rowCount > 0);
  });

  it("correctly parses columns from columnsV2", () => {
    const vm = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    assert.equal(vm.columns.length, 1);
    assert.equal(vm.columns[0].key, "2024-12-31");
    assert.equal(vm.columns[0].label, "Dec 2024");
  });

  it("groups rows by section headers", () => {
    const vm = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    assert.equal(vm.sections.length, 2);
    assert.equal(vm.sections[0].key, "BALANCE_SHEET");
    assert.equal(vm.sections[1].key, "INCOME_STATEMENT");
  });

  it("extracts numeric values from cells", () => {
    const vm = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    const cashRow = vm.sections[0].rows.find((r) => r.key === "CASH_AND_EQUIVALENTS");
    assert.ok(cashRow);
    assert.equal(cashRow.valueByCol["2024-12-31"], 500000);
  });

  it("parses string values to numbers", () => {
    const vm = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    const revRow = vm.sections[1].rows.find((r) => r.key === "TOTAL_REVENUE");
    assert.ok(revRow);
    assert.equal(revRow.valueByCol["2024-12-31"], 1000000);
  });
});

// ---------------------------------------------------------------------------
// 2. V2 adapter contract tests
// ---------------------------------------------------------------------------

describe("V2 adapter: renderFromFinancialModel", () => {
  it("produces valid SpreadViewModel from FinancialModel", () => {
    const vm = renderFromFinancialModel(MODEL);
    assert.equal(vm.source, "v2_model");
    assert.equal(vm.dealId, DEAL_ID);
    assert.equal(typeof vm.generatedAt, "string");
    assert.ok(vm.columns.length > 0);
    assert.ok(vm.sections.length > 0);
    assert.ok(vm.meta.rowCount > 0);
  });

  it("maps periods to columns", () => {
    const vm = renderFromFinancialModel(MODEL);
    assert.equal(vm.columns.length, 1);
    assert.equal(vm.columns[0].key, "2024-12-31");
    assert.equal(vm.columns[0].label, "Dec 2024");
  });

  it("populates CASH_AND_EQUIVALENTS from balance.cash", () => {
    const vm = renderFromFinancialModel(MODEL);
    const bsSection = vm.sections.find((s) => s.key === "BALANCE_SHEET");
    assert.ok(bsSection);
    const cashRow = bsSection.rows.find((r) => r.key === "CASH_AND_EQUIVALENTS");
    assert.ok(cashRow);
    assert.equal(cashRow.valueByCol["2024-12-31"], 500000);
  });

  it("has row keys unique within each section", () => {
    const vm = renderFromFinancialModel(MODEL);
    for (const section of vm.sections) {
      const keys = section.rows.map((r) => r.key);
      const unique = new Set(keys);
      assert.equal(unique.size, keys.length, `Duplicate key in ${section.key}: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Diff utility tests
// ---------------------------------------------------------------------------

describe("diffSpreadViewModels", () => {
  function makeVM(overrides: Partial<SpreadViewModel>): SpreadViewModel {
    return {
      source: "v1_legacy",
      dealId: DEAL_ID,
      generatedAt: "2024-01-01T00:00:00Z",
      columns: [{ key: "2024-12-31", label: "Dec 2024", kind: "other" }],
      sections: [{
        key: "BALANCE_SHEET",
        label: "Balance Sheet",
        rows: [{
          key: "CASH_AND_EQUIVALENTS",
          label: "Cash",
          section: "Current Assets",
          kind: "source",
          valueByCol: { "2024-12-31": 500000 },
          displayByCol: { "2024-12-31": "500,000" },
          formulaId: null,
        }],
      }],
      meta: { rowCount: 1, sectionCount: 1, periodCount: 1, nonNullCellCount: 1 },
      ...overrides,
    };
  }

  it("identical ViewModels → pass=true, 0 diffs", () => {
    const vm1 = makeVM({ source: "v1_legacy" });
    const vm2 = makeVM({ source: "v2_model" });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.equal(diff.summary.pass, true);
    assert.equal(diff.summary.differingCells, 0);
    assert.equal(diff.summary.materialDiffs, 0);
    assert.equal(diff.columnsMatch, true);
  });

  it("single value difference → correct delta", () => {
    const vm1 = makeVM({ source: "v1_legacy" });
    const vm2 = makeVM({
      source: "v2_model",
      sections: [{
        key: "BALANCE_SHEET",
        label: "Balance Sheet",
        rows: [{
          key: "CASH_AND_EQUIVALENTS",
          label: "Cash",
          section: "Current Assets",
          kind: "source",
          valueByCol: { "2024-12-31": 500100 },
          displayByCol: { "2024-12-31": "500,100" },
          formulaId: null,
        }],
      }],
    });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.equal(diff.summary.differingCells, 1);
    assert.equal(diff.sections[0].cellDiffs[0].delta, 100);
    assert.equal(diff.sections[0].cellDiffs[0].material, true); // $100 > $1
  });

  it("$1 difference → not material", () => {
    const vm1 = makeVM({ source: "v1_legacy" });
    const vm2 = makeVM({
      source: "v2_model",
      sections: [{
        key: "BALANCE_SHEET",
        label: "Balance Sheet",
        rows: [{
          key: "CASH_AND_EQUIVALENTS",
          label: "Cash",
          section: "Current Assets",
          kind: "source",
          valueByCol: { "2024-12-31": 500001 },
          displayByCol: { "2024-12-31": "500,001" },
          formulaId: null,
        }],
      }],
    });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.equal(diff.summary.differingCells, 1);
    assert.equal(diff.sections[0].cellDiffs[0].material, false); // $1 is NOT > $1
  });

  it("missing row in V2 → appears in rowsOnlyInV1", () => {
    const vm1 = makeVM({ source: "v1_legacy" });
    const vm2 = makeVM({
      source: "v2_model",
      sections: [{ key: "BALANCE_SHEET", label: "Balance Sheet", rows: [] }],
    });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.ok(diff.sections[0].rowsOnlyInV1.includes("CASH_AND_EQUIVALENTS"));
  });

  it("missing column in V2 → columnsMatch=false", () => {
    const vm1 = makeVM({ source: "v1_legacy" });
    const vm2 = makeVM({
      source: "v2_model",
      columns: [{ key: "2023-12-31", label: "Dec 2023", kind: "other" }],
    });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.equal(diff.columnsMatch, false);
    assert.ok(diff.columnDiffs.onlyInV1.includes("2024-12-31"));
    assert.ok(diff.columnDiffs.onlyInV2.includes("2023-12-31"));
  });

  it("both null values → not counted as difference", () => {
    const vm1 = makeVM({
      source: "v1_legacy",
      sections: [{
        key: "BALANCE_SHEET",
        label: "Balance Sheet",
        rows: [{
          key: "INVENTORY",
          label: "Inventory",
          section: "Current Assets",
          kind: "source",
          valueByCol: { "2024-12-31": null },
          displayByCol: { "2024-12-31": "—" },
          formulaId: null,
        }],
      }],
    });
    const vm2 = makeVM({
      source: "v2_model",
      sections: [{
        key: "BALANCE_SHEET",
        label: "Balance Sheet",
        rows: [{
          key: "INVENTORY",
          label: "Inventory",
          section: "Current Assets",
          kind: "source",
          valueByCol: { "2024-12-31": null },
          displayByCol: { "2024-12-31": "—" },
          formulaId: null,
        }],
      }],
    });
    const diff = diffSpreadViewModels(vm1, vm2);
    assert.equal(diff.summary.differingCells, 0);
    assert.equal(diff.summary.pass, true);
  });
});

// ---------------------------------------------------------------------------
// 4. Determinism tests
// ---------------------------------------------------------------------------

describe("adapter determinism", () => {
  it("V2 adapter: same input → same output (except generatedAt)", () => {
    const vm1 = renderFromFinancialModel(MODEL);
    const vm2 = renderFromFinancialModel(MODEL);

    // Normalize generatedAt for comparison
    vm1.generatedAt = "FIXED";
    vm2.generatedAt = "FIXED";

    assert.deepEqual(vm1, vm2);
  });

  it("V1 adapter: same input → same output (except generatedAt)", () => {
    const vm1 = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);
    const vm2 = renderFromLegacySpread(LEGACY_SPREAD, DEAL_ID);

    vm1.generatedAt = "FIXED";
    vm2.generatedAt = "FIXED";

    assert.deepEqual(vm1, vm2);
  });
});

// ---------------------------------------------------------------------------
// 5. Layout contract tests
// ---------------------------------------------------------------------------

describe("V2 adapter: layout contract", () => {
  it("produces exactly 5 sections (BS, IS, CF, Ratios, Exec)", () => {
    const vm = renderFromFinancialModel(MODEL);
    assert.equal(vm.sections.length, 5);
    const sectionKeys = vm.sections.map((s) => s.key);
    assert.ok(sectionKeys.includes("BALANCE_SHEET"));
    assert.ok(sectionKeys.includes("INCOME_STATEMENT"));
    assert.ok(sectionKeys.includes("CASH_FLOW"));
    assert.ok(sectionKeys.includes("RATIOS"));
    assert.ok(sectionKeys.includes("EXEC_SUMMARY"));
  });

  it("produces data rows matching MOODYS_ROWS.length", async () => {
    const { MOODYS_ROWS } = await import("@/lib/financialSpreads/moodys/mapping");
    const vm = renderFromFinancialModel(MODEL);
    assert.equal(vm.meta.rowCount, MOODYS_ROWS.length);
    // 82 rows: BS(24) + IS(28) + CF(4) + Ratios(19) + Exec(7)
    assert.equal(vm.meta.rowCount, 82);
  });
});
