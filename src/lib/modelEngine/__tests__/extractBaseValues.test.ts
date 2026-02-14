/**
 * Phase 13 — extractBaseValues Tests
 *
 * Validates the shared base values helper:
 * - Empty periods → empty map
 * - Income extraction
 * - Balance extraction (TOTAL_DEBT, CURRENT_ASSETS)
 * - Latest period selection
 * - GROSS_PROFIT derivation
 * - Determinism
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Phase 13 — extractBaseValues", () => {
  it("returns empty map for empty periods", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({ dealId: "d1", periods: [] });
    assert.deepStrictEqual(result, {});
  });

  it("extracts income fields from latest period", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE",
        income: { revenue: 1000000, cogs: 400000, netIncome: 150000, operatingExpenses: 200000, interest: 50000 },
        balance: {},
        cashflow: {},
        qualityFlags: [],
      }],
    });
    assert.equal(result["REVENUE"], 1000000);
    assert.equal(result["COGS"], 400000);
    assert.equal(result["NET_INCOME"], 150000);
    assert.equal(result["OPERATING_EXPENSES"], 200000);
    assert.equal(result["DEBT_SERVICE"], 50000);
  });

  it("extracts balance fields and computes TOTAL_DEBT", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE",
        income: {},
        balance: { totalAssets: 2000000, totalLiabilities: 800000, equity: 1200000, shortTermDebt: 100000, longTermDebt: 500000 },
        cashflow: {},
        qualityFlags: [],
      }],
    });
    assert.equal(result["TOTAL_ASSETS"], 2000000);
    assert.equal(result["TOTAL_LIABILITIES"], 800000);
    assert.equal(result["EQUITY"], 1200000);
    assert.equal(result["TOTAL_DEBT"], 600000); // 100k + 500k
    assert.equal(result["CURRENT_LIABILITIES"], 100000);
  });

  it("uses the latest period when multiple exist", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [
        {
          periodId: "p1",
          periodEnd: "2024-12-31",
          type: "FYE",
          income: { revenue: 500000 },
          balance: {},
          cashflow: {},
          qualityFlags: [],
        },
        {
          periodId: "p2",
          periodEnd: "2025-12-31",
          type: "FYE",
          income: { revenue: 800000 },
          balance: {},
          cashflow: {},
          qualityFlags: [],
        },
      ],
    });
    assert.equal(result["REVENUE"], 800000);
  });

  it("derives GROSS_PROFIT from revenue - cogs", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE",
        income: { revenue: 1000000, cogs: 400000 },
        balance: {},
        cashflow: {},
        qualityFlags: [],
      }],
    });
    assert.equal(result["GROSS_PROFIT"], 600000);
  });

  it("extracts cashflow fields", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE",
        income: {},
        balance: {},
        cashflow: { ebitda: 300000, cfads: 250000 },
        qualityFlags: [],
      }],
    });
    assert.equal(result["EBITDA"], 300000);
    assert.equal(result["CFADS"], 250000);
  });

  it("is deterministic (same model → same output)", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const model = {
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE" as const,
        income: { revenue: 1000000, cogs: 400000 },
        balance: { totalAssets: 2000000 },
        cashflow: { ebitda: 300000 },
        qualityFlags: [],
      }],
    };
    const r1 = extractBaseValues(model);
    const r2 = extractBaseValues(model);
    assert.deepStrictEqual(r1, r2);
  });

  it("computes CURRENT_ASSETS from cash + AR + inventory", async () => {
    const { extractBaseValues } = await import("../extractBaseValues");
    const result = extractBaseValues({
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE",
        income: {},
        balance: { cash: 50000, accountsReceivable: 100000, inventory: 75000 },
        cashflow: {},
        qualityFlags: [],
      }],
    });
    assert.equal(result["CURRENT_ASSETS"], 225000);
  });
});
