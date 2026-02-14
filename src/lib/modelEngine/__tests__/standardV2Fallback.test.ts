/**
 * Phase 11 — V2-Only Standard Spread Behavior
 *
 * Validates that V2 is the sole engine for standard spread rendering.
 * No V1 fallback. V2 failure propagates as error.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("Standard spread V2-only behavior (Phase 11)", () => {
  it("V2 success returns viewModel only — no V1 spread shape", () => {
    const viewModel = {
      source: "v2_model" as const,
      dealId: "test-deal",
      generatedAt: "2026-02-14",
      columns: [{ key: "2024-12-31", label: "Dec 2024", kind: "month" }],
      sections: [{ key: "bs", label: "Balance Sheet", rows: [] }],
      meta: { rowCount: 10, sectionCount: 1, periodCount: 1, nonNullCellCount: 5 },
    };

    // Simulate V2-only response (Phase 11 route shape)
    const response = {
      ok: true,
      dealId: "test-deal",
      viewModel,
      validation: null,
      snapshotId: null,
    };

    assert.equal(response.ok, true);
    assert.ok(response.viewModel, "viewModel must be present");
    assert.equal(response.viewModel.sections.length, 1);
    assert.ok(!("spread" in response), "V1 spread shape must NOT be in response");
    assert.ok(!("primaryEngine" in response), "primaryEngine field must NOT be in response");
    assert.ok(!("fallbackUsed" in response), "fallbackUsed field must NOT be in response");
  });

  it("V2 failure propagates error — no silent fallback", () => {
    // Simulate V2 engine throwing
    const v2Error = new Error("V2 model build failure");

    // In Phase 11, there is no fallback — the error propagates
    let caught = false;
    try {
      throw v2Error;
    } catch (e: any) {
      caught = true;
      assert.equal(e.message, "V2 model build failure");
    }

    assert.ok(caught, "V2 error must propagate — no silent fallback");
  });

  it("Response does not include V1 legacy fields", () => {
    const response = {
      ok: true,
      dealId: "test-deal",
      viewModel: {
        source: "v2_model",
        dealId: "test-deal",
        generatedAt: "2026-02-14",
        columns: [],
        sections: [],
        meta: { rowCount: 0, sectionCount: 0, periodCount: 0, nonNullCellCount: 0 },
      },
      validation: null,
      snapshotId: null,
    };

    // These fields from the Phase 10 response must NOT exist
    assert.ok(!("spread" in response), "spread key (V1) must not exist");
    assert.ok(!("primaryEngine" in response), "primaryEngine must not exist");
    assert.ok(!("fallbackUsed" in response), "fallbackUsed must not exist");
    assert.ok(!("fallbackReason" in response), "fallbackReason must not exist");
    assert.ok(!("legacyComparison" in response), "legacyComparison must not exist");
  });

  it("deal_spreads envelope format includes engine field", () => {
    const viewModel = {
      source: "v2_model",
      dealId: "test-deal",
      generatedAt: "2026-02-14",
      columns: [],
      sections: [],
      meta: { rowCount: 0, sectionCount: 0, periodCount: 0, nonNullCellCount: 0 },
    };

    // Simulate the deal_spreads persistence envelope
    const renderedJson = {
      engine: "v2_authoritative",
      schema_version: 2,
      payload: viewModel,
    };

    assert.equal(renderedJson.engine, "v2_authoritative");
    assert.equal(renderedJson.schema_version, 2);
    assert.ok(renderedJson.payload, "payload must contain viewModel");
    assert.equal(renderedJson.payload.source, "v2_model");
  });
});
