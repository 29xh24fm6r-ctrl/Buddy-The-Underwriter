import test from "node:test";
import assert from "node:assert/strict";
import { loadLatestCanonicalFactsTimestamp } from "@/lib/classicSpread/latestCanonicalFactsTimestamp";

test("uses the append-ledger created_at field as spread provenance", async () => {
  const calls: Array<[string, unknown?]> = [];
  const terminal = {
    maybeSingle: async () => ({ data: { created_at: "2026-08-18T18:00:00Z" }, error: null }),
  };
  const query: any = {
    select(value: string) { calls.push(["select", value]); return this; },
    eq(field: string, value: string) { calls.push(["eq", `${field}:${value}`]); return this; },
    order(field: string) { calls.push(["order", field]); return this; },
    limit(value: number) { calls.push(["limit", value]); return terminal; },
  };
  const sb = { from: (table: string) => { calls.push(["from", table]); return query; } };

  assert.equal(
    await loadLatestCanonicalFactsTimestamp(sb, "deal-1", "bank-1"),
    "2026-08-18T18:00:00Z",
  );
  assert.deepEqual(calls[1], ["select", "created_at"]);
  assert.deepEqual(calls.find((call) => call[0] === "order"), ["order", "created_at"]);
});

test("surfaces schema/query failures instead of silently stamping null", async () => {
  const terminal = { maybeSingle: async () => ({ data: null, error: new Error("schema mismatch") }) };
  const query: any = {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return terminal; },
  };
  await assert.rejects(
    loadLatestCanonicalFactsTimestamp({ from: () => query }, "deal-1", "bank-1"),
    /schema mismatch/,
  );
});
