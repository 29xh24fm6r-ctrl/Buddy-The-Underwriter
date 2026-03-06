import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractForm4562, computeNormalizedDepreciation } from "../form4562Deterministic";
import { extractScheduleM1, computeBookEbitda } from "../scheduleM1Deterministic";
import { extractForm1125A, normalizeLifoToFifo } from "../form1125aDeterministic";
import { extractForm1125E, assessOfficerCompensation } from "../form1125eDeterministic";
import { extractScheduleL, reconcileScheduleL } from "../scheduleLReconciliation";
import type { DeterministicExtractorArgs } from "../types";

const BASE_ARGS: DeterministicExtractorArgs = {
  dealId: "d1",
  bankId: "b1",
  documentId: "doc1",
  ocrText: "",
};

// =========================================================================
// Form 4562 — Depreciation & Amortization
// =========================================================================

describe("Form 4562 Extractor", () => {
  it("extracts Section 179 total", () => {
    const result = extractForm4562({
      ...BASE_ARGS,
      ocrText: "Part I — Elected to expense $125,000\nTax Year 2023",
    });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F4562_SEC179_TOTAL");
    assert.ok(item);
    assert.equal(item!.value, 125_000);
  });

  it("extracts bonus depreciation", () => {
    const result = extractForm4562({
      ...BASE_ARGS,
      ocrText: "Line 14 Special depreciation allowance $80,000\nTax Year 2022",
    });
    const item = result.items.find((i) => i.key === "F4562_BONUS_DEPRECIATION");
    assert.ok(item);
    assert.equal(item!.value, 80_000);
  });

  it("extracts MACRS deductions", () => {
    const result = extractForm4562({
      ...BASE_ARGS,
      ocrText: "Line 17 MACRS deductions $45,000\nTax Year 2023",
    });
    const item = result.items.find((i) => i.key === "F4562_MACRS_TOTAL");
    assert.ok(item);
    assert.equal(item!.value, 45_000);
  });

  it("extracts amortization total", () => {
    const result = extractForm4562({
      ...BASE_ARGS,
      ocrText: "Part VI Amortization of intangibles $30,000\nTax Year 2023",
    });
    const item = result.items.find((i) => i.key === "F4562_AMORTIZATION_TOTAL");
    assert.ok(item);
    assert.equal(item!.value, 30_000);
  });

  it("returns ok=false for unrelated text", () => {
    const result = extractForm4562({
      ...BASE_ARGS,
      ocrText: "This is a random document with no depreciation data",
    });
    assert.equal(result.ok, false);
  });
});

describe("Normalized Depreciation", () => {
  it("normalizes Section 179 + bonus over 7-year useful life", () => {
    const result = computeNormalizedDepreciation({
      sec179Total: 140_000,
      bonusDepreciation: 70_000,
      macrsTotal: 50_000,
      amortizationTotal: 10_000,
    });
    // Total = 140k + 70k + 50k + 10k = 270k
    assert.equal(result.totalTaxDepreciation, 270_000);
    // Normalized = 50k (MACRS) + (140k+70k)/7 (=30k) + 10k (amort) = 90k
    assert.equal(result.normalizedDepreciation, 90_000);
    assert.equal(result.addBackAmount, 180_000); // 270k - 90k
  });

  it("handles all nulls as zero", () => {
    const result = computeNormalizedDepreciation({
      sec179Total: null,
      bonusDepreciation: null,
      macrsTotal: null,
      amortizationTotal: null,
    });
    assert.equal(result.totalTaxDepreciation, 0);
    assert.equal(result.normalizedDepreciation, 0);
  });

  it("computes sec179 as percentage of total", () => {
    const result = computeNormalizedDepreciation({
      sec179Total: 100_000,
      bonusDepreciation: 0,
      macrsTotal: 100_000,
      amortizationTotal: 0,
    });
    assert.ok(result.sec179PctOfTotal !== null);
    assert.ok(Math.abs(result.sec179PctOfTotal! - 0.5) < 0.001);
  });
});

// =========================================================================
// Schedule M-1 / M-2 — Book-Tax Reconciliation
// =========================================================================

describe("Schedule M-1 Extractor", () => {
  it("extracts book income per books", () => {
    const result = extractScheduleM1({
      ...BASE_ARGS,
      ocrText: "Line 1 Net income per books $350,000\nTax Year 2023",
    });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "M1_BOOK_INCOME");
    assert.ok(item);
    assert.equal(item!.value, 350_000);
  });

  it("extracts depreciation book-tax diff", () => {
    const result = extractScheduleM1({
      ...BASE_ARGS,
      ocrText: "Line 5a Depreciation $85,000\nTax Year 2023",
    });
    const item = result.items.find((i) => i.key === "M1_DEPR_BOOK_TAX_DIFF");
    assert.ok(item);
    assert.equal(item!.value, 85_000);
  });

  it("extracts M-2 retained earnings", () => {
    const result = extractScheduleM1({
      ...BASE_ARGS,
      ocrText: "M-2 Line 1 Balance at beginning of year $200,000\nM-2 Line 7 Balance at end of year $280,000\nTax Year 2023",
    });
    const begin = result.items.find((i) => i.key === "M2_RETAINED_EARNINGS_BEGIN");
    const end = result.items.find((i) => i.key === "M2_RETAINED_EARNINGS_END");
    assert.ok(begin);
    assert.ok(end);
    assert.equal(begin!.value, 200_000);
    assert.equal(end!.value, 280_000);
  });

  it("extracts taxable income", () => {
    const result = extractScheduleM1({
      ...BASE_ARGS,
      ocrText: "Line 8 Taxable income $425,000\nTax Year 2023",
    });
    const item = result.items.find((i) => i.key === "M1_TAXABLE_INCOME");
    assert.ok(item);
    assert.equal(item!.value, 425_000);
  });
});

describe("Book EBITDA Computation", () => {
  it("computes book EBITDA = tax EBITDA + depr diff", () => {
    const result = computeBookEbitda(500_000, 85_000);
    assert.equal(result.bookEbitda, 585_000);
  });

  it("returns tax EBITDA when no depr diff", () => {
    const result = computeBookEbitda(500_000, null);
    assert.equal(result.bookEbitda, 500_000);
  });

  it("returns null when tax EBITDA is null", () => {
    const result = computeBookEbitda(null, 85_000);
    assert.equal(result.bookEbitda, null);
  });
});

// =========================================================================
// Form 1125-A — Cost of Goods Sold
// =========================================================================

describe("Form 1125-A Extractor", () => {
  it("extracts COGS line items", () => {
    const result = extractForm1125A({
      ...BASE_ARGS,
      ocrText: [
        "Form 1125-A Cost of Goods Sold",
        "Tax Year 2023",
        "Line 1 Inventory at beginning of year $50,000",
        "Line 2 Purchases $300,000",
        "Line 3 Cost of labor $120,000",
        "Line 7 Inventory at end of year $45,000",
        "Line 8 Cost of goods sold $425,000",
      ].join("\n"),
    });
    assert.ok(result.ok);
    assert.ok(result.items.some((i) => i.key === "F1125A_BEGIN_INVENTORY" && i.value === 50_000));
    assert.ok(result.items.some((i) => i.key === "F1125A_PURCHASES" && i.value === 300_000));
    assert.ok(result.items.some((i) => i.key === "F1125A_DIRECT_LABOR" && i.value === 120_000));
    assert.ok(result.items.some((i) => i.key === "F1125A_END_INVENTORY" && i.value === 45_000));
    assert.ok(result.items.some((i) => i.key === "F1125A_COGS" && i.value === 425_000));
  });

  it("extracts inventory method", () => {
    const result = extractForm1125A({
      ...BASE_ARGS,
      ocrText: "Inventory method: FIFO\nTax Year 2023\nLine 8 Cost of goods sold $100,000",
    });
    const item = result.items.find((i) => i.key === "F1125A_INVENTORY_METHOD");
    assert.ok(item);
    assert.equal(item!.value, "FIFO");
  });

  it("extracts LIFO election", () => {
    const result = extractForm1125A({
      ...BASE_ARGS,
      ocrText: "LIFO elected: Yes\nInventory method: LIFO\nTax Year 2023\nLine 8 Cost of goods sold $200,000",
    });
    const method = result.items.find((i) => i.key === "F1125A_INVENTORY_METHOD");
    const lifo = result.items.find((i) => i.key === "F1125A_LIFO_ELECTED");
    assert.ok(method);
    assert.equal(method!.value, "LIFO");
    assert.ok(lifo);
    assert.equal(lifo!.value, true);
  });

  it("extracts 263A costs", () => {
    const result = extractForm1125A({
      ...BASE_ARGS,
      ocrText: "Line 4 Uniform capitalization costs $15,000\nTax Year 2023",
    });
    const item = result.items.find((i) => i.key === "F1125A_263A_COSTS");
    assert.ok(item);
    assert.equal(item!.value, 15_000);
  });
});

describe("LIFO Reserve Normalization", () => {
  it("converts LIFO inventory to FIFO", () => {
    const result = normalizeLifoToFifo(
      100_000,  // LIFO inventory
      500_000,  // LIFO COGS
      50_000,   // current LIFO reserve
      40_000,   // prior LIFO reserve
    );
    assert.equal(result.fifoInventory, 150_000); // 100k + 50k
    assert.equal(result.fifoCogs, 490_000); // 500k - (50k - 40k)
    assert.equal(result.lifoReserveAdjustment, 10_000);
  });
});

// =========================================================================
// Form 1125-E — Compensation of Officers
// =========================================================================

describe("Form 1125-E Extractor", () => {
  it("extracts total compensation from text", () => {
    const result = extractForm1125E({
      ...BASE_ARGS,
      ocrText: "Total compensation of officers $350,000\nTax Year 2023",
    });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F1125E_TOTAL_COMPENSATION");
    assert.ok(item);
    assert.equal(item!.value, 350_000);
  });

  it("extracts officer name from labeled field", () => {
    const result = extractForm1125E({
      ...BASE_ARGS,
      ocrText: "Name of officer: John Smith\nAmount of compensation $200,000\nTax Year 2023",
    });
    const name = result.items.find((i) => i.key === "F1125E_OFFICER_NAME");
    const comp = result.items.find((i) => i.key === "F1125E_COMPENSATION");
    assert.ok(name);
    assert.equal(name!.value, "John Smith");
    assert.ok(comp);
    assert.equal(comp!.value, 200_000);
  });

  it("extracts compensation via labeled field fallback", () => {
    const result = extractForm1125E({
      ...BASE_ARGS,
      ocrText: [
        "Tax Year 2023",
        "Name of officer: Jane Doe",
        "Amount of compensation $250,000",
        "Total compensation of officers $250,000",
      ].join("\n"),
    });
    const names = result.items.filter((i) => i.key === "F1125E_OFFICER_NAME");
    const comps = result.items.filter((i) => i.key === "F1125E_COMPENSATION");
    assert.ok(names.length >= 1);
    assert.equal(names[0].value, "Jane Doe");
    assert.ok(comps.length >= 1);
    assert.equal(comps[0].value, 250_000);
  });
});

describe("Officer Compensation Analysis", () => {
  it("flags above-market FTE compensation", () => {
    const result = assessOfficerCompensation("John Smith", 300_000, 50, 200_000);
    // FTE = 300k / 0.50 = 600k > 200k market
    assert.equal(result.fteEquivalent, 600_000);
    assert.equal(result.aboveMarketRate, true);
    assert.equal(result.excessAmount, 200_000); // 300k - (200k × 0.50)
  });

  it("does not flag at-market compensation", () => {
    const result = assessOfficerCompensation("Jane Doe", 150_000, 100, 200_000);
    assert.equal(result.fteEquivalent, 150_000);
    assert.equal(result.aboveMarketRate, false);
    assert.equal(result.excessAmount, 0);
  });

  it("handles 100% time correctly", () => {
    const result = assessOfficerCompensation("Bob", 250_000, 100, 200_000);
    assert.equal(result.fteEquivalent, 250_000);
    assert.equal(result.aboveMarketRate, true);
    assert.equal(result.excessAmount, 50_000);
  });
});

// =========================================================================
// Schedule L — Balance Sheet per Tax Return
// =========================================================================

describe("Schedule L Extractor", () => {
  it("extracts asset line items", () => {
    const result = extractScheduleL({
      ...BASE_ARGS,
      ocrText: [
        "Schedule L Balance Sheet",
        "Tax Year 2023",
        "Line 1 Cash $150,000",
        "Line 3 Inventories $80,000",
        "Line 15 Total assets $1,200,000",
      ].join("\n"),
    });
    assert.ok(result.ok);
    assert.ok(result.items.some((i) => i.key === "SL_CASH" && i.value === 150_000));
    assert.ok(result.items.some((i) => i.key === "SL_INVENTORY" && i.value === 80_000));
    assert.ok(result.items.some((i) => i.key === "SL_TOTAL_ASSETS" && i.value === 1_200_000));
  });

  it("extracts liability and equity items", () => {
    const result = extractScheduleL({
      ...BASE_ARGS,
      ocrText: [
        "Tax Year 2023",
        "Line 16 Accounts payable $75,000",
        "Total liabilities $300,000",
        "Line 24 Retained earnings $500,000",
      ].join("\n"),
    });
    assert.ok(result.items.some((i) => i.key === "SL_ACCOUNTS_PAYABLE" && i.value === 75_000));
    assert.ok(result.items.some((i) => i.key === "SL_TOTAL_LIABILITIES" && i.value === 300_000));
    assert.ok(result.items.some((i) => i.key === "SL_RETAINED_EARNINGS" && i.value === 500_000));
  });

  it("extracts PPE and accumulated depreciation", () => {
    const result = extractScheduleL({
      ...BASE_ARGS,
      ocrText: [
        "Tax Year 2023",
        "Line 10a Buildings and other depreciable assets $800,000",
        "Line 10b Less accumulated depreciation $250,000",
      ].join("\n"),
    });
    assert.ok(result.items.some((i) => i.key === "SL_PPE_GROSS" && i.value === 800_000));
    assert.ok(result.items.some((i) => i.key === "SL_ACCUMULATED_DEPRECIATION" && i.value === 250_000));
  });
});

describe("Schedule L Reconciliation", () => {
  it("passes when variance within 3%", () => {
    const result = reconcileScheduleL(
      { totalAssets: 1_000_000, totalLiabilities: 500_000, totalEquity: 500_000 },
      { totalAssets: 990_000, totalLiabilities: 495_000, totalEquity: 495_000 },
    );
    assert.equal(result.hasBreaches, false);
    assert.ok(result.message.includes("reconciles"));
  });

  it("flags when total assets variance >3%", () => {
    const result = reconcileScheduleL(
      { totalAssets: 1_000_000, totalLiabilities: 500_000, totalEquity: 500_000 },
      { totalAssets: 900_000, totalLiabilities: 500_000, totalEquity: 400_000 },
    );
    assert.equal(result.hasBreaches, true);
    assert.ok(result.message.includes("BALANCE SHEET DISCREPANCY"));
    assert.ok(result.totalAssetsVariancePct !== null);
    assert.ok(result.totalAssetsVariancePct! > 0.03);
  });

  it("handles null inputs gracefully", () => {
    const result = reconcileScheduleL(
      { totalAssets: null, totalLiabilities: null, totalEquity: null },
      { totalAssets: 1_000_000, totalLiabilities: 500_000, totalEquity: 500_000 },
    );
    assert.equal(result.hasBreaches, false);
    assert.equal(result.variances.length, 0);
    assert.ok(result.message.includes("Insufficient"));
  });

  it("correctly computes variance percentage", () => {
    const result = reconcileScheduleL(
      { totalAssets: 1_050_000, totalLiabilities: null, totalEquity: null },
      { totalAssets: 1_000_000, totalLiabilities: null, totalEquity: null },
    );
    assert.equal(result.variances.length, 1);
    assert.ok(Math.abs(result.variances[0].variancePct - 0.05) < 0.001);
    assert.equal(result.variances[0].breachesThreshold, true);
  });
});
