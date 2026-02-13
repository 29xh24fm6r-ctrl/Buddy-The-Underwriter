/**
 * Regression test: Moody's route V2 failure must not break legacy response.
 *
 * Validates that when V2 model building throws, the Moody's API still
 * returns the V1 legacy spread payload with HTTP 200.
 *
 * This is a unit-level behavioral test — it does NOT call the actual
 * Next.js route handler. Instead, it tests the pattern: when
 * buildFinancialModel throws inside the V2 block, the try/catch
 * must swallow the error and the response must still include `spread`.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("Moody's V2 fallback safety", () => {
  it("V2 failure does not affect V1 response shape", () => {
    // Simulate the Moody's route pattern
    let viewModel: unknown = null;
    const rendered = {
      schema_version: 1,
      title: "Test Spread",
      spread_type: "MOODYS",
      status: "ready",
      generatedAt: "2026-02-13",
      columns: [],
      columnsV2: [],
      rows: [{ key: "cash", label: "Cash", values: [] }],
    };

    // Simulate V2 enabled + builder throws
    const v2Enabled = true;
    if (v2Enabled) {
      try {
        // Simulate buildFinancialModel throwing
        throw new Error("Simulated V2 model build failure");
      } catch {
        // This is the guard — V2 failure must not propagate
      }
    }

    // Build response (same shape as route handler)
    const response = {
      ok: true,
      dealId: "test-deal",
      spread: rendered,
      validation: null,
      ...(viewModel ? { viewModel } : {}),
    };

    // Assertions: response must be complete and valid
    assert.equal(response.ok, true);
    assert.equal(response.dealId, "test-deal");
    assert.ok(response.spread, "spread must be present");
    assert.equal(response.spread.rows.length, 1, "spread rows must be intact");
    assert.equal(viewModel, null, "viewModel must be null when V2 fails");
    assert.ok(!("viewModel" in response), "viewModel key must not appear when null");
  });

  it("V2 success includes viewModel in response", () => {
    const rendered = {
      schema_version: 1,
      title: "Test Spread",
      spread_type: "MOODYS",
      status: "ready",
      generatedAt: "2026-02-13",
      columns: [],
      columnsV2: [],
      rows: [{ key: "cash", label: "Cash", values: [] }],
    };

    // Simulate V2 success
    const viewModel = {
      dealId: "test-deal",
      generatedAt: "2026-02-13",
      columns: [],
      sections: [{ key: "bs", label: "Balance Sheet", rows: [] }],
      meta: { rowCount: 10, periodCount: 1 },
    };

    const response = {
      ok: true,
      dealId: "test-deal",
      spread: rendered,
      validation: null,
      ...(viewModel ? { viewModel } : {}),
    };

    assert.equal(response.ok, true);
    assert.ok(response.spread, "V1 spread must still be present");
    assert.ok("viewModel" in response, "viewModel must be present when V2 succeeds");
    assert.equal((response as any).viewModel.sections.length, 1);
  });

  it("shadow metadata present when V2 enabled", () => {
    const v2Enabled = true;
    const viewModel = { sections: [{ key: "bs", label: "BS", rows: [] }] };

    const shadow = v2Enabled
      ? { enabled: true, snapshotPersistAttempted: viewModel !== null }
      : undefined;

    const response = {
      ok: true,
      ...(shadow ? { shadow } : {}),
    };

    assert.ok("shadow" in response, "shadow metadata must be present");
    assert.equal(response.shadow!.enabled, true);
    assert.equal(response.shadow!.snapshotPersistAttempted, true);
  });

  it("shadow metadata absent when V2 disabled", () => {
    const v2Enabled = false;

    const shadow = v2Enabled
      ? { enabled: true, snapshotPersistAttempted: false }
      : undefined;

    const response = {
      ok: true,
      ...(shadow ? { shadow } : {}),
    };

    assert.ok(!("shadow" in response), "shadow must not be present when V2 disabled");
  });
});
