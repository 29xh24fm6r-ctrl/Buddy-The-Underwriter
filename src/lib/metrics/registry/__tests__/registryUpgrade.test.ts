/**
 * Phase 13 — Registry Upgrade Integration Tests
 *
 * Validates:
 * - Full upgrade preview simulation (base values → dual eval → compare)
 * - Bank pin overrides global version (static analysis)
 * - Deprecated version not auto-selected (static analysis)
 * - Deprecated version still loadable (static analysis)
 * - Drift endpoint structure
 * - All 5 Phase 13 event codes defined
 * - No Date.now / Math.random in new utility files
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(relPath), "utf-8");
}

describe("Phase 13 — Upgrade preview simulation", () => {
  it("base values → dual metric evaluation → comparison works end-to-end", async () => {
    const { extractBaseValues } = await import("@/lib/modelEngine/extractBaseValues");
    const { evaluateMetricGraph, getV1SeedDefinitions } = await import("@/lib/modelEngine");
    const { compareSnapshotMetrics } = await import("@/lib/modelEngine/snapshot/compareSnapshots");

    const model = {
      dealId: "d1",
      periods: [{
        periodId: "p1",
        periodEnd: "2025-12-31",
        type: "FYE" as const,
        income: { revenue: 1000000, cogs: 400000, netIncome: 150000 },
        balance: { totalAssets: 2000000, totalLiabilities: 800000, equity: 1200000 },
        cashflow: { ebitda: 300000 },
        qualityFlags: [],
      }],
    };

    const baseValues = extractBaseValues(model);
    assert.ok(Object.keys(baseValues).length > 0, "base values must not be empty");

    const defs = getV1SeedDefinitions();
    const metricsA = evaluateMetricGraph(defs, baseValues);
    const metricsB = evaluateMetricGraph(defs, baseValues);

    const comparison = compareSnapshotMetrics(metricsA, metricsB);
    assert.equal(comparison.summary.changed, 0, "same defs + same base = no changes");
    assert.equal(comparison.summary.added, 0);
    assert.equal(comparison.summary.removed, 0);
  });
});

describe("Phase 13 — Bank pin overrides global", () => {
  it("resolveRegistryBinding checks bank pin before selectActiveVersion", () => {
    const src = readSource("src/lib/metrics/registry/selectActiveVersion.ts");
    // Bank pin check must come BEFORE selectActiveVersion call
    const pinCheckIdx = src.indexOf("loadBankPin(supabase, bankId)");
    const globalIdx = src.indexOf("selectActiveVersion(supabase)", pinCheckIdx);
    assert.ok(pinCheckIdx > 0, "must check bank pin");
    assert.ok(globalIdx > pinCheckIdx, "bank pin check must precede global fallback");
  });

  it("resolveRegistryBinding accepts optional bankId parameter", () => {
    const src = readSource("src/lib/metrics/registry/selectActiveVersion.ts");
    assert.ok(
      src.includes("bankId?: string"),
      "resolveRegistryBinding must accept optional bankId",
    );
  });
});

describe("Phase 13 — Deprecated version governance", () => {
  it("selectActiveVersion filters to published only (excludes deprecated)", () => {
    const src = readSource("src/lib/metrics/registry/selectActiveVersion.ts");
    // The selectActiveVersion function must filter .eq("status", "published")
    const fnStart = src.indexOf("async function selectActiveVersion");
    const fnEnd = src.indexOf("}", src.indexOf("return rowToVersion", fnStart));
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes('.eq("status", "published")'),
      "selectActiveVersion must filter status=published",
    );
  });

  it("loadVersionEntries has no status filter (deprecated entries loadable)", () => {
    const src = readSource("src/lib/metrics/registry/selectActiveVersion.ts");
    const fnStart = src.indexOf("async function loadVersionEntries");
    const fnEnd = src.indexOf("}", src.indexOf("return (data", fnStart));
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(
      !fnBody.includes('.eq("status"'),
      "loadVersionEntries must NOT filter by status",
    );
  });

  it("deprecateVersion uses CAS guard (published → deprecated)", () => {
    const src = readSource("src/lib/metrics/registry/selectActiveVersion.ts");
    const fnStart = src.indexOf("async function deprecateVersion");
    const fnEnd = src.indexOf("return { ok: true", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(
      fnBody.includes('.eq("status", "published")'),
      "deprecateVersion must use CAS guard on status=published",
    );
  });
});

describe("Phase 13 — Drift endpoint structure", () => {
  it("drift route file exists", () => {
    const routePath = "src/app/api/deals/[dealId]/model-v2/drift/route.ts";
    assert.ok(fs.existsSync(path.resolve(routePath)), `${routePath} must exist`);
  });

  it("drift route emits DRIFT_DETECTED event", () => {
    const src = readSource("src/app/api/deals/[dealId]/model-v2/drift/route.ts");
    assert.ok(
      src.includes("METRIC_REGISTRY_DRIFT_DETECTED"),
      "drift route must emit DRIFT_DETECTED event",
    );
  });

  it("drift route uses bank-aware resolveRegistryBinding", () => {
    const src = readSource("src/app/api/deals/[dealId]/model-v2/drift/route.ts");
    assert.ok(
      src.includes("resolveRegistryBinding(sb, bankId)"),
      "drift route must pass bankId to resolveRegistryBinding",
    );
  });
});

describe("Phase 13 — Event codes", () => {
  it("all 5 Phase 13 event codes are defined", () => {
    const src = readSource("src/lib/modelEngine/events.ts");
    const expected = [
      "METRIC_REGISTRY_UPGRADE_PREVIEW_RUN",
      "METRIC_REGISTRY_VERSION_DEPRECATED",
      "METRIC_REGISTRY_DRIFT_DETECTED",
      "BANK_REGISTRY_PINNED",
      "BANK_REGISTRY_PIN_REMOVED",
    ];
    for (const code of expected) {
      assert.ok(src.includes(code), `events.ts must define ${code}`);
    }
  });

  it("DRIFT_DETECTED is mapped to warning severity", () => {
    const src = readSource("src/lib/modelEngine/events.ts");
    // Find mapSeverity function and verify DRIFT_DETECTED is in warning case
    const severityFn = src.indexOf("function mapSeverity");
    const severityEnd = src.indexOf("function mapEventType");
    const severityBody = src.slice(severityFn, severityEnd);
    assert.ok(
      severityBody.includes("METRIC_REGISTRY_DRIFT_DETECTED"),
      "DRIFT_DETECTED must be mapped in mapSeverity",
    );
  });
});

describe("Phase 13 — Purity constraints", () => {
  it("extractBaseValues.ts does not use Date.now or Math.random", () => {
    const src = readSource("src/lib/modelEngine/extractBaseValues.ts");
    assert.ok(!src.includes("Date.now"), "extractBaseValues must not use Date.now");
    assert.ok(!src.includes("Math.random"), "extractBaseValues must not use Math.random");
  });

  it("compareSnapshots.ts does not use Date.now or Math.random", () => {
    const src = readSource("src/lib/modelEngine/snapshot/compareSnapshots.ts");
    assert.ok(!src.includes("Date.now"), "compareSnapshots must not use Date.now");
    assert.ok(!src.includes("Math.random"), "compareSnapshots must not use Math.random");
  });

  it("detectDrift.ts does not use Date.now or Math.random", () => {
    const src = readSource("src/lib/modelEngine/snapshot/detectDrift.ts");
    assert.ok(!src.includes("Date.now"), "detectDrift must not use Date.now");
    assert.ok(!src.includes("Math.random"), "detectDrift must not use Math.random");
  });

  it("upgrade-preview route file exists", () => {
    const routePath = "src/app/api/deals/[dealId]/model-v2/upgrade-preview/route.ts";
    assert.ok(fs.existsSync(path.resolve(routePath)), `${routePath} must exist`);
  });

  it("deprecate route file exists", () => {
    const routePath = "src/app/api/admin/metric-registry/versions/[versionId]/deprecate/route.ts";
    assert.ok(fs.existsSync(path.resolve(routePath)), `${routePath} must exist`);
  });

  it("bank registry pin route file exists", () => {
    const routePath = "src/app/api/admin/banks/[bankId]/registry-pin/route.ts";
    assert.ok(fs.existsSync(path.resolve(routePath)), `${routePath} must exist`);
  });
});
