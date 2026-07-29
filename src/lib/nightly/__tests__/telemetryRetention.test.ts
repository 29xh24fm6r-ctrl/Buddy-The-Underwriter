import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../telemetryRetention") as typeof import("../telemetryRetention");

function fakeSb(rpcImpl: (name: string) => { data: unknown; error: { message?: string } | null }) {
  const inserts: any[] = [];
  const rpcCalls: string[] = [];
  const sb = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return rpcImpl(name);
    },
    from: (_table: string) => ({
      insert: async (row: any) => {
        inserts.push(row);
        return { data: null, error: null };
      },
    }),
  };
  return { sb, inserts, rpcCalls };
}

test("runTelemetryRetentionPurge: invokes all three purge RPCs in order", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((name) => ({ data: name.length, error: null }));

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.deepEqual(rpcCalls, [
    "purge_buddy_system_events",
    "purge_franchise_sync_runs",
    "purge_buddy_workers",
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0]!.table, "buddy_system_events");
  assert.equal(results[1]!.table, "franchise_sync_runs");
  assert.equal(results[2]!.table, "buddy_workers");

  assert.equal(inserts.length, 1, "should write one purge-result event");
  assert.equal(inserts[0].event_type, "telemetry_retention_purge_completed");
  assert.equal(inserts[0].payload.results.length, 3);
});

test("runTelemetryRetentionPurge: missing RPC is a loud failure, not a skip", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((name) => {
    if (name === "purge_franchise_sync_runs") {
      return { data: null, error: { message: 'function "purge_franchise_sync_runs" does not exist' } };
    }
    return { data: 0, error: null };
  });

  await assert.rejects(
    () => m.runTelemetryRetentionPurge(sb),
    /purge_franchise_sync_runs.*does not exist/,
  );

  assert.deepEqual(rpcCalls, ["purge_buddy_system_events", "purge_franchise_sync_runs"], "must stop at first failure, not continue past it");
  assert.equal(inserts.length, 0, "no result event on failure");
});

test("runTelemetryRetentionPurge: coerces RPC row-count to a number", async () => {
  const { sb } = fakeSb(() => ({ data: "12345", error: null })); // bigint often arrives as string
  const results = await m.runTelemetryRetentionPurge(sb);
  for (const r of results) {
    assert.equal(r.rowsPurged, 12345);
  }
});
