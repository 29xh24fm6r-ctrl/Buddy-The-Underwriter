import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotFromFacts, type MinimalFact } from "../financialSnapshotCore";

// LTV facts are only written by the underwriting-synthesis route; the spread
// job recompute never produces them, so a CRE snapshot sat at "ltv_gross
// missing" while carrying both the loan amount and the collateral value.

function fact(over: Partial<MinimalFact> & { id: string; fact_type: string; fact_key: string; fact_value_num: number }): MinimalFact {
  return {
    fact_period_start: "1900-01-01",
    fact_period_end: "1900-01-01",
    fact_value_text: null,
    confidence: 0.95,
    provenance: { source_type: "MANUAL", source_ref: "deal_loan_requests:x", as_of_date: "2026-08-27" },
    created_at: "2026-08-27T00:00:00.000Z",
    ...over,
  };
}

const SPECS = [
  { metric: "bank_loan_total" as const, fact_type: "SOURCES_USES", fact_key: "BANK_LOAN_TOTAL" },
  { metric: "collateral_gross_value" as const, fact_type: "COLLATERAL", fact_key: "GROSS_VALUE" },
  { metric: "collateral_net_value" as const, fact_type: "COLLATERAL", fact_key: "NET_VALUE" },
  { metric: "ltv_gross" as const, fact_type: "FINANCIAL_ANALYSIS", fact_key: "LTV_GROSS" },
  { metric: "ltv_net" as const, fact_type: "FINANCIAL_ANALYSIS", fact_key: "LTV_NET" },
];

test("snapshot derives ltv_gross from loan amount / collateral when no LTV fact exists", () => {
  const snap = buildSnapshotFromFacts({
    facts: [
      fact({ id: "loan", fact_type: "SOURCES_USES", fact_key: "BANK_LOAN_TOTAL", fact_value_num: 960_000 }),
      fact({ id: "coll", fact_type: "COLLATERAL", fact_key: "GROSS_VALUE", fact_value_num: 1_200_000 }),
    ],
    metricSpecs: SPECS,
    dealType: "CONVENTIONAL",
    loanRequest: { product_type: "CRE_PURCHASE", occupancy_type: "OWNER_OCCUPIED" },
  });
  assert.equal(snap.ltv_gross.value_num, 0.8);
  assert.equal(snap.ltv_gross.provenance?.extractor, "snapshot:ltv_fallback:v1");
  assert.equal(snap.ltv_gross.as_of_date, "2026-08-27");
  // No net collateral value on file → ltv_net stays empty rather than guessed.
  assert.equal(snap.ltv_net.value_num, null);
  assert.ok(!snap.missing_required_keys.includes("ltv_gross"));
});

test("snapshot keeps an explicit LTV fact over the computed fallback", () => {
  const snap = buildSnapshotFromFacts({
    facts: [
      fact({ id: "loan", fact_type: "SOURCES_USES", fact_key: "BANK_LOAN_TOTAL", fact_value_num: 960_000 }),
      fact({ id: "coll", fact_type: "COLLATERAL", fact_key: "GROSS_VALUE", fact_value_num: 1_200_000 }),
      fact({ id: "ltv", fact_type: "FINANCIAL_ANALYSIS", fact_key: "LTV_GROSS", fact_value_num: 0.75, provenance: { source_type: "STRUCTURAL" } }),
    ],
    metricSpecs: SPECS,
  });
  assert.equal(snap.ltv_gross.value_num, 0.75);
  assert.notEqual(snap.ltv_gross.provenance?.extractor, "snapshot:ltv_fallback:v1");
});

test("snapshot does not derive LTV from zero or missing collateral", () => {
  const snap = buildSnapshotFromFacts({
    facts: [
      fact({ id: "loan", fact_type: "SOURCES_USES", fact_key: "BANK_LOAN_TOTAL", fact_value_num: 960_000 }),
      fact({ id: "coll", fact_type: "COLLATERAL", fact_key: "GROSS_VALUE", fact_value_num: 0 }),
    ],
    metricSpecs: SPECS,
  });
  assert.equal(snap.ltv_gross.value_num, null);
});
