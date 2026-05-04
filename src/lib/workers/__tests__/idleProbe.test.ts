import test from "node:test";
import assert from "node:assert/strict";

import { hasOutboxWork } from "../idleProbe";

type Filter = { kind: "is" | "or" | "eq" | "in" | "not"; args: unknown[] };

function makeBuilder(rows: any[] | null, error?: { message: string } | null) {
  const filters: Filter[] = [];
  let limitVal: number | null = null;
  let table = "";
  let columns = "";

  const builder: any = {
    _filters: filters,
    _table: () => table,
    _columns: () => columns,
    _limit: () => limitVal,
    from(t: string) {
      table = t;
      return builder;
    },
    select(cols: string) {
      columns = cols;
      return builder;
    },
    is(...args: unknown[]) {
      filters.push({ kind: "is", args });
      return builder;
    },
    or(...args: unknown[]) {
      filters.push({ kind: "or", args });
      return builder;
    },
    eq(...args: unknown[]) {
      filters.push({ kind: "eq", args });
      return builder;
    },
    in(...args: unknown[]) {
      filters.push({ kind: "in", args });
      return builder;
    },
    not(...args: unknown[]) {
      filters.push({ kind: "not", args });
      return builder;
    },
    limit(n: number) {
      limitVal = n;
      // builder is awaitable here — return a promise-like with the result
      return Promise.resolve({ data: rows, error: error ?? null });
    },
  };
  return builder;
}

test("idleProbe: returns false when no rows match", async () => {
  const builder = makeBuilder([]);
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  const has = await hasOutboxWork({ sb, includeKinds: ["doc.extract"] });
  assert.equal(has, false);
  assert.equal(builder._table(), "buddy_outbox_events");
  assert.equal(builder._limit(), 1, "must use LIMIT 1 — single-row probe");
});

test("idleProbe: returns true when at least one row matches", async () => {
  const builder = makeBuilder([{ id: "abc" }]);
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  const has = await hasOutboxWork({ sb, includeKinds: ["intake.process"] });
  assert.equal(has, true);
});

test("idleProbe: applies includeKinds via eq for single kind", async () => {
  const builder = makeBuilder([]);
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  await hasOutboxWork({ sb, includeKinds: ["doc.extract"] });
  const eqFilter = builder._filters.find((f: Filter) => f.kind === "eq");
  assert.ok(eqFilter, "single includeKinds must use eq()");
  assert.deepEqual(eqFilter.args, ["kind", "doc.extract"]);
});

test("idleProbe: applies excludeKinds via not-in", async () => {
  const builder = makeBuilder([]);
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  await hasOutboxWork({ sb, excludeKinds: ["intake.process"] });
  const notFilter = builder._filters.find((f: Filter) => f.kind === "not");
  assert.ok(notFilter, "excludeKinds must call .not()");
  assert.equal(notFilter.args[0], "kind");
  assert.equal(notFilter.args[1], "in");
});

test("idleProbe: filters delivered/dead/claimed columns", async () => {
  const builder = makeBuilder([]);
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  await hasOutboxWork({ sb, includeKinds: ["doc.extract"] });
  const isFilters = builder._filters.filter((f: Filter) => f.kind === "is");
  const isCols = isFilters.map((f: Filter) => f.args[0]);
  assert.ok(isCols.includes("delivered_at"));
  assert.ok(isCols.includes("dead_lettered_at"));
  // claimed_at is in the OR clause for stale-claim recovery
  const orFilter = builder._filters.find((f: Filter) => f.kind === "or");
  assert.ok(orFilter);
  assert.match(String(orFilter.args[0]), /claimed_at/);
});

test("idleProbe: fails open on probe error so claim path stays authoritative", async () => {
  const builder = makeBuilder(null, { message: "boom" });
  const sb: any = {
    from: (t: string) => builder.from(t),
  };
  const has = await hasOutboxWork({ sb, includeKinds: ["doc.extract"] });
  assert.equal(has, true, "probe errors must fail open");
});
