import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickAuthoritativeFact, pickLatestFact } from "../templateUtils";
import type { FinancialFact } from "../types";

function fact(over: Partial<FinancialFact> & { id: string }): FinancialFact {
  return {
    deal_id: "d",
    bank_id: "b",
    source_document_id: "00000000-0000-0000-0000-000000000000",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "CASH_FLOW_AVAILABLE",
    fact_period_start: null,
    fact_period_end: null,
    fact_value_num: null,
    fact_value_text: null,
    currency: "USD",
    confidence: 0.8,
    provenance: {},
    created_at: "2026-08-27T22:23:27.000Z",
    owner_type: "DEAL",
    ...over,
  };
}

describe("pickAuthoritativeFact", () => {
  // Deal c0f6caab: canonical waterfall NCADS on the sentinel period vs a
  // backfill echo of a YTD figure stamped with the fiscal-year end.
  const waterfall = fact({
    id: "wf",
    fact_value_num: 274_072,
    fact_period_start: "1900-01-01",
    fact_period_end: "1900-01-01",
    confidence: 0.85,
    provenance: { source_type: "STRUCTURAL", extractor: "computeCashFlowWaterfallFacts:v1" },
  });
  const echo = fact({
    id: "echo",
    fact_value_num: 35_746.75,
    fact_period_start: "2026-12-31",
    fact_period_end: "2026-12-31",
    confidence: 0.9,
    created_at: "2026-08-27T22:25:24.000Z",
    provenance: { source_type: "SPREAD", extractor: "backfillCanonicalFactsFromSpreads:v1", as_of_date: "2026-12-31" },
  });

  it("prefers the structural engine result over a later-dated spread echo", () => {
    const chosen = pickAuthoritativeFact({
      facts: [echo, waterfall],
      factType: "FINANCIAL_ANALYSIS",
      factKey: "CASH_FLOW_AVAILABLE",
    });
    assert.equal(chosen?.id, "wf");
    // Documents the behaviour this replaces: period-only ranking picks the echo.
    const latest = pickLatestFact({
      facts: [echo, waterfall],
      factType: "FINANCIAL_ANALYSIS",
      factKey: "CASH_FLOW_AVAILABLE",
    });
    assert.equal(latest?.id, "echo");
  });

  it("falls back to the spread echo when nothing stronger exists", () => {
    const chosen = pickAuthoritativeFact({
      facts: [echo],
      factType: "FINANCIAL_ANALYSIS",
      factKey: "CASH_FLOW_AVAILABLE",
    });
    assert.equal(chosen?.id, "echo");
  });

  it("ignores other keys and returns null when nothing matches", () => {
    const chosen = pickAuthoritativeFact({
      facts: [echo, waterfall],
      factType: "FINANCIAL_ANALYSIS",
      factKey: "EXCESS_CASH_FLOW",
    });
    assert.equal(chosen, null);
  });

  it("within the same source tier, still prefers the most recent period", () => {
    const older = fact({
      id: "old",
      fact_value_num: 1,
      fact_period_end: "2024-12-31",
      provenance: { source_type: "STRUCTURAL" },
    });
    const newer = fact({
      id: "new",
      fact_value_num: 2,
      fact_period_end: "2025-12-31",
      provenance: { source_type: "STRUCTURAL" },
    });
    const chosen = pickAuthoritativeFact({
      facts: [older, newer],
      factType: "FINANCIAL_ANALYSIS",
      factKey: "CASH_FLOW_AVAILABLE",
    });
    assert.equal(chosen?.id, "new");
  });
});
