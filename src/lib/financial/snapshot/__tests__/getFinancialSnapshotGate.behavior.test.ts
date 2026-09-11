import test from "node:test";
import assert from "node:assert/strict";

// The production module is server-only. Stub that framework marker before the
// CommonJS test runner loads the module so this behavioral test exercises the
// gate rather than Next's client-import sentinel.
require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeModule;

const { getFinancialSnapshotGate } = require("../getFinancialSnapshotGate") as typeof import("../getFinancialSnapshotGate");

test("database uncertainty blocks readiness without fabricating evidence", async () => {
  const failingQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return { data: null, error: { message: "database unavailable" } };
    },
  };
  const client = {
    from() { return failingQuery; },
  } as unknown as Parameters<typeof getFinancialSnapshotGate>[1] extends { client?: infer T } ? T : never;

  const result = await getFinancialSnapshotGate("deal-test", { client });

  assert.equal(result.evaluationStatus, "unavailable");
  assert.equal(result.ready, false);
  assert.equal(result.blockerCode, "financial_validation_unavailable");
  assert.equal(result.evidence, null);
});
