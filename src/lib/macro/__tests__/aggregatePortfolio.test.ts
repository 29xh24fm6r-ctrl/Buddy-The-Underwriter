import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { aggregatePortfolio } =
  require("../aggregatePortfolio") as typeof import("../aggregatePortfolio");

type DbError = { message: string } | null;
type QueryOperation = {
  table: string;
  operation: "eq" | "in";
  column: string;
  value: unknown;
};

function fakeClient(options: {
  deals?: Array<{ id: string | null }>;
  dealReadError?: DbError;
  snapshots?: any[];
  readError?: DbError;
  writeError?: DbError;
}) {
  const writes: any[] = [];
  const operations: QueryOperation[] = [];

  function readableQuery(
    table: string,
    data: unknown[],
    error: DbError,
  ) {
    const query: any = {
      select() {
        return this;
      },
      eq(column: string, value: unknown) {
        operations.push({ table, operation: "eq", column, value });
        return this;
      },
      in(column: string, value: unknown) {
        operations.push({ table, operation: "in", column, value });
        return this;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) {
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
    return query;
  }

  const client = {
    from(table: string) {
      if (table === "deals") {
        return readableQuery(
          table,
          options.deals ?? [{ id: "deal-1" }],
          options.dealReadError ?? null,
        );
      }
      if (table === "decision_snapshots") {
        return readableQuery(
          table,
          options.snapshots ?? [],
          options.readError ?? null,
        );
      }
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

  return { client, writes, operations };
}

test("aggregatePortfolio: no bank deals is a normal empty result", async () => {
  const { client, writes, operations } = fakeClient({ deals: [] });
  const result = await aggregatePortfolio("bank-empty", client as any);
  assert.equal(result, null);
  assert.deepEqual(writes, []);
  assert.deepEqual(operations, [
    {
      table: "deals",
      operation: "eq",
      column: "bank_id",
      value: "bank-empty",
    },
  ]);
});

test("aggregatePortfolio: deal-scope read failure remains loud", async () => {
  const { client } = fakeClient({
    dealReadError: { message: "tenant lookup unavailable" },
  });
  await assert.rejects(
    () => aggregatePortfolio("bank-scope-failure", client as any),
    /Portfolio deal scope read failed.*tenant lookup unavailable/,
  );
});

test("aggregatePortfolio: no final decisions is a normal empty result", async () => {
  const { client, writes } = fakeClient({ snapshots: [] });
  const result = await aggregatePortfolio("bank-no-decisions", client as any);
  assert.equal(result, null);
  assert.deepEqual(writes, []);
});

test("aggregatePortfolio: decision read is scoped through canonical bank deals", async () => {
  const { client, operations } = fakeClient({
    deals: [{ id: "deal-a" }, { id: "deal-b" }],
    snapshots: [],
  });

  await aggregatePortfolio("bank-live", client as any);

  assert.deepEqual(operations, [
    {
      table: "deals",
      operation: "eq",
      column: "bank_id",
      value: "bank-live",
    },
    {
      table: "decision_snapshots",
      operation: "in",
      column: "deal_id",
      value: ["deal-a", "deal-b"],
    },
    {
      table: "decision_snapshots",
      operation: "eq",
      column: "status",
      value: "final",
    },
  ]);
  assert.equal(
    operations.some(
      (operation) =>
        operation.table === "decision_snapshots" &&
        operation.column === "bank_id",
    ),
    false,
  );
});

test("aggregatePortfolio: database decision read failure is not mislabeled as empty", async () => {
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
