import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";
import { renderFromFinancialModel } from "../renderer/v2Adapter";
import { extractBaseValues } from "../extractBaseValues";
import { classicTraditionalEbitda } from "@/lib/classicSpread/classicEbitda";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";

function rows(values: Record<string, number>): FactInput[] {
  return Object.entries(values).map(([fact_key, fact_value_num]) => ({
    fact_key, fact_value_num, fact_type: "TAX_RETURN", fact_period_end: "2025-12-31", confidence: 0.95,
  }));
}
for (const [name, values, expected] of [
  ["after-tax books add back the tax provision and amortization", { NET_INCOME: 100000, TOTAL_TAX: 30000, INTEREST_EXPENSE: 10000, DEPRECIATION: 20000, AMORTIZATION: 5000 }, 165000],
  ["ordinary income does not add tax twice", { ORDINARY_BUSINESS_INCOME: 150000, NET_INCOME: 100000, TOTAL_TAX: 30000, INTEREST_EXPENSE: 10000, DEPRECIATION: 20000, AMORTIZATION: 5000 }, 185000],
  ["M1 taxable income wins over after-tax book income", { M1_TAXABLE_INCOME: 130000, NET_INCOME: 100000, TOTAL_TAX: 30000, INTEREST_EXPENSE: 10000 }, 140000],
  ["explicit zero income remains zero", { NET_INCOME: 0, TOTAL_TAX: 0 }, 0],
] as Array<[string, Record<string, number>, number]>) {
  test(name, () => {
    const model = buildFinancialModel("deal", rows(values));
    assert.equal(model.periods[0].cashflow.ebitda, expected);
    assert.equal(extractBaseValues(model).EBITDA, expected);
    const rendered = renderFromFinancialModel(model).sections.flatMap(section => section.rows);
    for (const key of ["EBITDA", "R_EBITDA_DOLLARS", "ES_EBITDA"]) {
      assert.equal(rendered.find(row => row.key === key)?.valueByCol["2025-12-31"], expected, key);
    }
    assert.equal(classicTraditionalEbitda(key => values[key] ?? null), expected);
    assert.equal(computeEbitda(values, "UNKNOWN", { ebitda_addback_stack: "conservative" }).adjustedEbitda, expected);
  });
}

test("zero tax is evidence, not a missing-tax warning", () => {
  const result = computeEbitda({ NET_INCOME: 100000, TOTAL_TAX: 0 }, "UNKNOWN");
  assert.equal(result.adjustedEbitda, 100000);
  assert.equal(result.warnings.some(w => w.includes("no tax provision")), false);
});

test("revenue alone cannot become EBITDA by assuming expenses are zero", () => {
  const period = buildFinancialModel("deal", rows({ TOTAL_REVENUE: 1000000 })).periods[0];
  assert.equal(period.cashflow.ebitda, undefined);
});

test("invalidated evidence and weaker duplicates cannot change EBITDA", () => {
  const accepted = rows({ NET_INCOME: 100000, TOTAL_TAX: 30000 });
  const candidates: FactInput[] = [
    ...accepted,
    { ...accepted[0], fact_value_num: 900000, resolution_status: "rejected", confidence: 1 },
    { ...accepted[0], fact_value_num: 800000, is_superseded: true, confidence: 1 },
    { ...accepted[0], fact_value_num: 700000, resolution_status: "system_invalidated", confidence: 1 },
    { ...accepted[0], fact_value_num: 200000, confidence: 0.1 },
    { ...accepted[0], fact_value_num: Infinity, confidence: 1 },
  ];
  for (const input of [candidates, [...candidates].reverse()]) {
    assert.equal(buildFinancialModel("deal", input).periods[0].cashflow.ebitda, 130000);
  }
});

for (const values of [{ ADJUSTED_GROSS_INCOME: 250000 }, { TOTAL_REVENUE: 1000000 }] as Array<Record<string, number>>) {
  test(`renderer cannot recreate unavailable business EBITDA from ${Object.keys(values)[0]}`, () => {
    const model = buildFinancialModel("deal", rows(values));
    const rendered = renderFromFinancialModel(model).sections.flatMap(section => section.rows);
    for (const key of ["EBITDA", "R_EBITDA_DOLLARS", "ES_EBITDA", "R_EBITDA_MARGIN", "ES_EBITDA_MARGIN"]) {
      assert.equal(rendered.find(row => row.key === key)?.valueByCol["2025-12-31"], null, key);
    }
  });
}
