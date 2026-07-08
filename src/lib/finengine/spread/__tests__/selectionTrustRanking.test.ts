/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — trust-first fact selection.
 *
 * A higher-document-trust source (audited/reviewed) must win over a lower-trust source (tax return /
 * interim) even when the lower-trust source carries higher extractor confidence — and audited/reviewed/
 * compiled statements must be reachable in the BUSINESS scope at all (they were silently dropped).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { independentRawSelect } from "@/lib/finengine/spread/selectionGuard";
import { scopeOf, type CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const row = (over: Partial<CertifiedFactRow>): CertifiedFactRow =>
  ({
    fact_key: "TOTAL_ASSETS",
    fact_period_end: "2024-12-31",
    is_superseded: false,
    fact_value_num: 100,
    source_canonical_type: "BUSINESS_TAX_RETURN",
    confidence: 0.9,
    extractor: "gemini",
    owner_type: "DEAL",
    owner_entity_id: null,
    resolution_status: "active",
    ...over,
  }) as unknown as CertifiedFactRow;

test("audited/reviewed/compiled statements classify to the BUSINESS scope (no longer dropped)", () => {
  assert.equal(scopeOf(row({ source_canonical_type: "AUDITED_FINANCIALS" })), "BUSINESS");
  assert.equal(scopeOf(row({ source_canonical_type: "REVIEWED_FINANCIALS" })), "BUSINESS");
  assert.equal(scopeOf(row({ source_canonical_type: "COMPILED_FINANCIALS" })), "BUSINESS");
});

test("a higher-trust audited value wins over a higher-confidence tax return for the same period", () => {
  const rows = [
    row({ source_canonical_type: "AUDITED_FINANCIALS", confidence: 0.70, fact_value_num: 200 }),
    row({ source_canonical_type: "BUSINESS_TAX_RETURN", confidence: 0.95, fact_value_num: 100 }),
  ];
  const picked = independentRawSelect(rows, "TOTAL_ASSETS", "BUSINESS", "2024-12-31");
  assert.equal(picked.value, 200, "audited (trust 100) beats tax return (trust 70) despite lower confidence");
  assert.equal(picked.source, "AUDITED_FINANCIALS");
});

test("within the same trust tier, higher confidence still wins", () => {
  const rows = [
    row({ source_canonical_type: "BUSINESS_TAX_RETURN", confidence: 0.80, fact_value_num: 100 }),
    row({ source_canonical_type: "BUSINESS_TAX_RETURN", confidence: 0.95, fact_value_num: 105 }),
  ];
  const picked = independentRawSelect(rows, "TOTAL_ASSETS", "BUSINESS", "2024-12-31");
  assert.equal(picked.value, 105);
});

test("superseded and off-period rows are excluded", () => {
  const rows = [
    row({ source_canonical_type: "AUDITED_FINANCIALS", fact_value_num: 200, is_superseded: true }),
    row({ source_canonical_type: "AUDITED_FINANCIALS", fact_value_num: 300, fact_period_end: "2023-12-31" }),
    row({ source_canonical_type: "BUSINESS_TAX_RETURN", fact_value_num: 100 }),
  ];
  const picked = independentRawSelect(rows, "TOTAL_ASSETS", "BUSINESS", "2024-12-31");
  assert.equal(picked.value, 100, "only the in-period, non-superseded tax return qualifies");
});
