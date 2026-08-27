import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../telemetryRetention") as typeof import("../telemetryRetention");

type RpcReply = {
  data: unknown;
  error: { message?: string } | null;
};

function fakeSb(
  rpcImpl: (name: string, callForName: number) => RpcReply,
  insertError: { message?: string } | null = null,
) {
  const inserts: any[] = [];
  const rpcCalls: string[] = [];
  const callsByName = new Map<string, number>();
  const sb = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      const callForName = callsByName.get(name) ?? 0;
      callsByName.set(name, callForName + 1);
      return rpcImpl(name, callForName);
    },
    from: (_table: string) => ({
      insert: async (row: any) => {
        inserts.push(row);
        return { data: null, error: insertError };
      },
    }),
  };
  return { sb, inserts, rpcCalls };
}

test("runTelemetryRetentionPurge: commits batches until each table is drained", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((_name, callForName) => ({
    data: callForName === 0 ? m.RETENTION_BATCH_SIZE : 2,
    error: null,
  }));

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.deepEqual(rpcCalls, [
    "purge_buddy_system_events",
    "purge_buddy_system_events",
    "purge_franchise_sync_runs",
    "purge_franchise_sync_runs",
    "purge_buddy_workers",
    "purge_buddy_workers",
  ]);
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.rowsPurged, m.RETENTION_BATCH_SIZE + 2);
    assert.equal(result.batches, 2);
    assert.equal(result.drained, true);
  }

  assert.equal(inserts.length, 1);
  assert.equal(
    inserts[0].event_type,
    "telemetry_retention_purge_completed",
  );
  assert.deepEqual(inserts[0].payload.failures, []);
});

test("runTelemetryRetentionPurge: caps backlog work per table", async () => {
  const { sb, rpcCalls } = fakeSb(() => ({
    data: m.RETENTION_BATCH_SIZE,
    error: null,
  }));

  const results = await m.runTelemetryRetentionPurge(sb);

  assert.equal(
    rpcCalls.length,
    3 * m.MAX_RETENTION_BATCHES_PER_TABLE,
  );
  for (const result of results) {
    assert.equal(
      result.rowsPurged,
      m.RETENTION_BATCH_SIZE * m.MAX_RETENTION_BATCHES_PER_TABLE,
    );
    assert.equal(
      result.batches,
      m.MAX_RETENTION_BATCHES_PER_TABLE,
    );
    assert.equal(result.drained, false);
  }
});

test("runTelemetryRetentionPurge: one failure does not starve other tables", async () => {
  const { sb, rpcCalls, inserts } = fakeSb((name) => {
    if (name === "purge_franchise_sync_runs") {
      return {
        data: null,
        error: {
          message: 'function "purge_franchise_sync_runs" does not exist',
        },
      };
    }
    return { data: 0, error: null };
  });

  await assert.rejects(
    () => m.runTelemetryRetentionPurge(sb),
    (error: unknown) => {
      assert.ok(error instanceof m.TelemetryRetentionPurgeError);
      assert.equal(error.failures.length, 1);
      assert.equal(error.results.length, 3);
      assert.match(error.message, /franchise_sync_runs.*does not exist/);
      return true;
    },
  );

  assert.deepEqual(rpcCalls, [
    "purge_buddy_system_events",
    "purge_franchise_sync_runs",
    "purge_buddy_workers",
  ]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].event_type, "telemetry_retention_purge_failed");
});

test("runTelemetryRetentionPurge: coerces bounded bigint counts", async () => {
  const { sb } = fakeSb(() => ({ data: "1234", error: null }));
  const results = await m.runTelemetryRetentionPurge(sb);
  for (const result of results) {
    assert.equal(result.rowsPurged, 1234);
    assert.equal(result.drained, true);
  }
});

test("runTelemetryRetentionPurge: rejects impossible row counts", async () => {
  const { sb } = fakeSb(() => ({
    data: m.RETENTION_BATCH_SIZE + 1,
    error: null,
  }));

  await assert.rejects(
    () => m.runTelemetryRetentionPurge(sb),
    /invalid batch count/,
  );
});
