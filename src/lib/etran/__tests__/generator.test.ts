import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTruthToETran, generateETranXML } from "@/lib/etran/generator";

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

/**
 * Regression test for the real bug: generateETranXML used to query
 * deal_truth_snapshots.select("truth") and read row.truth — but the real
 * column (both in the original 20251227000002_agent_arbitration.sql
 * migration and the restored 20260718000008 one) is truth_json. This fake
 * client only implements the exact truth_json/version/settings shape
 * those migrations define, so it would have failed loudly against the old
 * ("truth") query.
 */
function makeFakeEtranSb(truthJson: Record<string, unknown>) {
  return {
    from(table: string) {
      if (table === "deal_truth_snapshots") {
        return {
          select: (cols: string) => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: async () => ({ data: cols === "id" ? { id: "snap-1" } : null, error: null }),
                }),
              }),
              single: async () => ({
                data: cols === "truth_json" ? { truth_json: truthJson } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "banks") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { settings: { sba_lender_id: "L1", sba_service_center: "SC1" } } }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

test("generateETranXML: reads deal_truth_snapshots.truth_json (not .truth) and produces XML", async () => {
  const result = await generateETranXML({
    dealId: "deal-1",
    bankId: "bank-1",
    sb: makeFakeEtranSb(truthFor(120_000, "sba_7a")) as any,
  });

  assert.ok(result.xml.includes("Acme LLC"), "XML should contain data pulled from truth_json");
  assert.ok(result.xml.includes("<LenderID>L1</LenderID>"));
});
