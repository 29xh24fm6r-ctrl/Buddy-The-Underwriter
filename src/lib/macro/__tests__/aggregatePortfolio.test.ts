import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { aggregatePortfolio } =
  require("../aggregatePortfolio") as typeof import("../aggregatePortfolio");

type DbError = { message: string } | null;

function fakeClient(options: {
  snapshots?: any[];
  readError?: DbError;
  writeError?: DbError;
}) {
  const writes: any[] = [];
  const decisionQuery: any = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve({
        data: options.snapshots ?? [],
        error: options.readError ?? null,
      }).then(resolve, reject);
    },
  };

  const client = {
    from(table: string) {
      if (table === "decision_snapshots") return decisionQuery;
      if (table === "portfolio_risk_snapshots") {
        return {
          async upsert(row: any) {
            writes.push(row);
            return { data: null, error: options.writeError ?? null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, writes };
}

test("aggregatePortfolio: no final decisions is a normal empty result", async () => {
  const { client, writes } = fakeClient({ snapshots: [] });
  const result = await aggregatePortfolio("bank-empty", client as any);
  assert.equal(result, null);
  assert.deepEqual(writes, []);
});

test("aggregatePortfolio: database read failure is not mislabeled as empty", async () => {
  const { client } = fakeClient({
    readError: { message: "connection unavailable" },
  });
  await assert.rejects(
    () => aggregatePortfolio("bank-read-failure", client as any),
    /Portfolio decision read failed.*connection unavailable/,
  );
});

test("aggregatePortfolio: computes and durably writes a non-empty snapshot", async () => {
  const { client, writes } = fakeClient({
    snapshots: [
      {
        inputs_json: { loan_amount: 250000 },
        model_json: { risk_weight: 1.2 },
        exceptions_json: ["policy"],
        committee_required: true,
        decision: "approve",
      },
      {
        inputs_json: { loan_amount: 750000 },
        model_json: { risk_weight: 0.8 },
        exceptions_json: [],
        committee_required: false,
        decision: "refer",
      },
    ],
  });

  const result = await aggregatePortfolio("bank-live", client as any);

  assert.ok(result);
  assert.equal(result.total_decisions, 2);
  assert.equal(result.total_exposure, 1_000_000);
  assert.equal(result.risk_weighted_exposure, 900_000);
  assert.equal(result.exception_rate, 0.5);
  assert.equal(result.committee_override_rate, 0.5);
  assert.equal(writes.length, 1);
});

test("aggregatePortfolio: snapshot write failure remains loud", async () => {
  const { client } = fakeClient({
    snapshots: [
      {
        inputs_json: { loan_amount: 100000 },
        model_json: { risk_weight: 1 },
        decision: "approve",
      },
    ],
    writeError: { message: "upsert denied" },
  });

  await assert.rejects(
    () => aggregatePortfolio("bank-write-failure", client as any),
    /Portfolio snapshot write failed.*upsert denied/,
  );
});
