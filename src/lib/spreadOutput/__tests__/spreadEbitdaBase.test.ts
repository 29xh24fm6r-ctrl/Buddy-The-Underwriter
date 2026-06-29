/**
 * SPEC-EBITDA-BASE-INCOME-WIRE-1 — live-spread EBITDA base wiring.
 *
 * buildCanonicalFactsFromRows must resolve the EBITDA base via the shared
 * resolver, so a year with only M1_TAXABLE_INCOME (no OBI, NET_INCOME zeroed)
 * uses M1 as the base instead of silently understating to 0.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalFactsFromRows,
  type CanonicalFactRow,
} from "@/lib/spreadOutput/canonicalFacts";

function row(p: Partial<CanonicalFactRow>): CanonicalFactRow {
  return {
    fact_key: p.fact_key ?? "",
    fact_value_num: p.fact_value_num ?? null,
    fact_value_text: p.fact_value_text ?? null,
    fact_period_end: p.fact_period_end ?? null,
    source_canonical_type: p.source_canonical_type ?? null,
  };
}

test("[spread-ebitda-base-1] M1_TAXABLE_INCOME drives EBITDA base when OBI absent and NET_INCOME=0", () => {
  const { facts } = buildCanonicalFactsFromRows([
    row({ fact_key: "M1_TAXABLE_INCOME", fact_value_num: 200925, fact_period_end: "2024-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
    row({ fact_key: "DEPRECIATION", fact_value_num: 210207, fact_period_end: "2024-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
    row({ fact_key: "NET_INCOME", fact_value_num: 0, fact_period_end: "2024-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
  ]);

  // Resolved base surfaced for the display row.
  assert.equal(facts["EBITDA_BASE_2024"], 200925);
  // EBITDA uses 200925 as the base (not the NET_INCOME=0 the inline path picked).
  assert.equal(facts["EBITDA_2024"], 200925 + 210207);
});
