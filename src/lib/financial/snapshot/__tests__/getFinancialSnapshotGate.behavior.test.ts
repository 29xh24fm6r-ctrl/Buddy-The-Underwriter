import test from "node:test";
import assert from "node:assert/strict";
import { getFinancialSnapshotGate } from "../getFinancialSnapshotGate";

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
