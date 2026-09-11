import assert from "node:assert/strict";
import test from "node:test";

require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeModule;

const { assemblePackageBundle } = require("../package-bundle") as typeof import("../package-bundle");

const completePaths = {
  businessPlanPdf: "deal/final/business-plan.pdf",
  projectionsPdf: "deal/final/projections.pdf",
  projectionsXlsx: "deal/final/projections.xlsx",
  feasibilityPdf: "deal/final/feasibility.pdf",
};

test("returns the persisted governed bundle and its complete artifact manifest", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await assemblePackageBundle("deal-1", "bank-1", "legacy-snapshot-1", async (args) => {
    calls.push(args);
    return { ok: true, bundleId: "bundle-1", mode: "final", paths: completePaths, businessPlanAttested: true };
  });

  assert.deepEqual(calls, [{ dealId: "deal-1", mode: "final" }]);
  assert.deepEqual(result, { ok: true, bundleId: "bundle-1", artifacts: completePaths });
});

test("fails closed when the governed release gate rejects the package", async () => {
  const result = await assemblePackageBundle("deal-1", "bank-1", "snapshot-1", async () => ({
    ok: false,
    bundleId: "bundle-1",
    error: "Golden Trident release blocked: stale canonical memo",
  }));
  assert.deepEqual(result, { ok: false, error: "Golden Trident release blocked: stale canonical memo" });
});

test("never reports success for a partial artifact set", async () => {
  const result = await assemblePackageBundle("deal-1", "bank-1", "snapshot-1", async () => ({
    ok: true,
    bundleId: "bundle-1",
    mode: "final",
    paths: { ...completePaths, projectionsXlsx: null },
    businessPlanAttested: false,
  }));
  assert.deepEqual(result, { ok: false, error: "Governed package incomplete: missing projectionsXlsx" });
});

test("turns unexpected factory errors into a failed package result", async () => {
  const result = await assemblePackageBundle("deal-1", "bank-1", "snapshot-1", async () => {
    throw new Error("storage unavailable");
  });
  assert.deepEqual(result, { ok: false, error: "storage unavailable" });
});
