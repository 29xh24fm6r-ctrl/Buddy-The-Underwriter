import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../telemetryRetention") as typeof import("../telemetryRetention");

type RpcReply = { data: unknown; error: { message?: string } | null };

function fakeSb(rpcImpl: (name: string, call: number) => RpcReply) {
  const inserts: any[] = [];
  const rpcCalls: string[] = [];
  const callsByName = new Map<string, number>();
  let insertError: { message?: string } | null = null;

  const sb = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      const call = (callsByName.get(name) ?? 0) + 1;
      callsByName.set(name, call);
      return rpcImpl(name, call);
    },
    from: (_table: string) => ({
      insert: async (row: any) => {
        inserts.push(row);
        return { data: null, error: insertError };
      },
    }),
  };

  return {
    sb,
    inserts,
    rpcCalls,
    setInsertError: (error: { message?: string }) => {
      insertError = error;
    },
  };
}

test("drained tables invoke all three RPCs and write completion evidence", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((name) => ({
    data: name.length,
    error: null,
  }));

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.deepEqual(rpcCalls, [
    "purge_buddy_system_events",
    "purge_franchise_sync_runs",
    "purge_buddy_workers",
  ]);
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.complete));
  assert.ok(results.every((result) => result.stoppedReason === "drained"));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].event_type, "telemetry_retention_purge_completed");
  assert.equal(inserts[0].severity, "info");
});

test("large tables are drained through independently committed batches", async () => {
  const { sb, rpcCalls } = fakeSb((_name, call) => ({
    data: call < 3 ? "1000" : "12",
    error: null,
  }));

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.equal(rpcCalls.length, 9);
  for (const result of results) {
    assert.equal(result.rowsPurged, 2012);
    assert.equal(result.batches, 3);
    assert.equal(result.complete, true);
  }
});

test("one RPC failure remains loud in evidence but does not starve later tables", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((name) => {
    if (name === "purge_buddy_system_events") {
      return { data: null, error: { message: "statement timeout" } };
    }
    return { data: 0, error: null };
  });

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.deepEqual(rpcCalls, [
    "purge_buddy_system_events",
    "purge_franchise_sync_runs",
    "purge_buddy_workers",
  ]);
  assert.equal(results[0]!.stoppedReason, "rpc_error");
  assert.equal(results[0]!.error, "statement timeout");
  assert.equal(results[1]!.complete, true);
  assert.equal(results[2]!.complete, true);
  assert.equal(inserts[0].event_type, "telemetry_retention_purge_partial");
  assert.equal(inserts[0].severity, "warning");
});

test("batch limits return resumable partial progress instead of one long transaction", async () => {
  const { sb } = fakeSb(() => ({ data: 1000, error: null }));

  const results = await m.runTelemetryRetentionPurge(sb, {
    maxBatchesPerTable: 2,
    timeBudgetMs: 60_000,
  });

  for (const result of results) {
    assert.equal(result.rowsPurged, 2000);
    assert.equal(result.batches, 2);
    assert.equal(result.complete, false);
    assert.equal(result.stoppedReason, "batch_limit");
  }
});

test("the global time budget prevents an unbounded worker invocation", async () => {
  let time = 0;
  const { sb } = fakeSb(() => {
    time += 10;
    return { data: 1000, error: null };
  });

  const results = await m.runTelemetryRetentionPurge(sb, {
    timeBudgetMs: 15,
    now: () => time,
  });

  assert.equal(results[0]!.batches, 2);
  assert.equal(results[0]!.stoppedReason, "time_budget");
  assert.equal(results[1]!.batches, 0);
  assert.equal(results[2]!.batches, 0);
});

test("audit persistence failure is surfaced after preserving purge results", async () => {
  const f = fakeSb(() => ({ data: 0, error: null }));
  f.setInsertError({ message: "audit unavailable" });

  await assert.rejects(
    () => m.runTelemetryRetentionPurge(f.sb),
    /evidence write failed: audit unavailable/,
  );
});
