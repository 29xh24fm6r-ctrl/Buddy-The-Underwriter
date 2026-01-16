import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSnapshotFromFacts,
  selectBestFact,
  type MinimalFact,
  type MetricSpec,
} from "@/lib/deals/financialSnapshotCore";

test("selectBestFact prefers MANUAL over SPREAD over DOC_EXTRACT", () => {
    const facts: MinimalFact[] = [
      {
        id: "1",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "DSCR",
      fact_period_start: null,
      fact_period_end: null,
      fact_value_num: 1.11,
      fact_value_text: null,
        confidence: 0.9,
      provenance: { source_type: "SPREAD", source_ref: "spread:t12", as_of_date: "2024-12-31" },
      created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "DSCR",
      fact_period_start: null,
      fact_period_end: null,
      fact_value_num: 1.05,
      fact_value_text: null,
        confidence: 0.99,
      provenance: { source_type: "DOC_EXTRACT", source_ref: "doc:123", as_of_date: "2024-12-31" },
      created_at: "2025-01-02T00:00:00Z",
      },
      {
        id: "3",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "DSCR",
      fact_period_start: null,
      fact_period_end: null,
      fact_value_num: 1.25,
      fact_value_text: null,
        confidence: 0.1,
      provenance: { source_type: "MANUAL", source_ref: "ui", as_of_date: "2024-12-31" },
      created_at: "2025-01-03T00:00:00Z",
      },
    ];

  const { chosen } = selectBestFact(facts);
  assert.equal(chosen?.id, "3");
  });

test("selectBestFact prefers most recent as_of_date (within same source_type)", () => {
    const facts: MinimalFact[] = [
      {
        id: "1",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "NOI_TTM",
      fact_period_start: null,
      fact_period_end: null,
      fact_value_num: 100,
      fact_value_text: null,
        confidence: 0.5,
      provenance: { source_type: "MANUAL", source_ref: "ui", as_of_date: "2023-12-31" },
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "2",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "NOI_TTM",
      fact_period_start: null,
      fact_period_end: null,
      fact_value_num: 120,
      fact_value_text: null,
        confidence: 0.2,
      provenance: { source_type: "MANUAL", source_ref: "ui", as_of_date: "2024-12-31" },
        created_at: "2025-01-01T00:00:00Z",
      },
    ];

  const { chosen } = selectBestFact(facts);
  assert.equal(chosen?.id, "2");
  });

test("buildSnapshotFromFacts does not silently merge as_of_dates", () => {
    const specs: MetricSpec[] = [
      { metric: "dscr", fact_type: "FINANCIAL_ANALYSIS", fact_key: "DSCR" },
      { metric: "noi_ttm", fact_type: "FINANCIAL_ANALYSIS", fact_key: "NOI_TTM" },
    ];

    const facts: MinimalFact[] = [
      {
        id: "1",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "DSCR",
        fact_period_start: null,
        fact_period_end: null,
        fact_value_num: 1.2,
        fact_value_text: null,
        confidence: 0.5,
        provenance: { source_type: "MANUAL", source_ref: "ui", as_of_date: "2024-12-31" },
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        fact_type: "FINANCIAL_ANALYSIS",
        fact_key: "NOI_TTM",
        fact_period_start: null,
        fact_period_end: null,
        fact_value_num: 100,
        fact_value_text: null,
        confidence: 0.5,
        provenance: { source_type: "MANUAL", source_ref: "ui", as_of_date: "2023-12-31" },
        created_at: "2025-01-01T00:00:00Z",
      },
    ];

    const snapshot = buildSnapshotFromFacts({ facts, metricSpecs: specs });
    assert.equal(snapshot.as_of_date, null);
    assert.ok(snapshot.sources_summary.some((s) => s.note === "mixed_as_of_dates"));
  });
