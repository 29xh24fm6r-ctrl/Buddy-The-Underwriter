import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTruthToETran } from "@/lib/etran/generator";

function truthFor(amount: number, dealType: string) {
  return {
    business: {
      legal_name: "Acme LLC",
      ein: "12-3456789",
      address: { street: "1 Main", city: "Boston", state: "MA", zip: "02110" },
      naics_code: "541512",
      entity_type: "LLC",
      number_of_employees: 5,
    },
    loan: {
      amount,
      term_months: 120,
      interest_rate: 0.085,
      deal_type: dealType,
      use_of_proceeds: [],
    },
    ownership: { owners: [] },
    financials: { revenue_trailing_12: 0, ebitda: 0, dscr: 0 },
    collateral: { items: [] },
  };
}

test("etran generator: $120K SBA 7(a) Standard → 85% guarantee (Small Loan)", () => {
  const data = mapTruthToETran(truthFor(120_000, "sba_7a"), "L1", "SC1");
  assert.equal(data.sba_guarantee_percentage, 85);
});

test("etran generator: $400K SBA 7(a) Standard → 75% guarantee", () => {
  const data = mapTruthToETran(truthFor(400_000, "sba_7a"), "L1", "SC1");
  assert.equal(data.sba_guarantee_percentage, 75);
});

test("etran generator: $300K Export Express → 90% guarantee", () => {
  const data = mapTruthToETran(
    truthFor(300_000, "sba_7a_export_express"),
    "L1",
    "SC1",
  );
  assert.equal(data.sba_guarantee_percentage, 90);
});
