/**
 * Tests for cleanupStaleAnalysisRuns.
 *
 * Verifies that only `running` rows for `model_name='banker_analysis_pipeline'`
 * older than the cutoff are reaped, that the update flips them to
 * `failed`/`error='stale_running_timeout'`, and that one
 * `banker_analysis.stale_run_recovered` event is emitted per reaped row.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupStaleAnalysisRuns,
  STALE_RUN_ERROR,
  STALE_RUN_EVENT_KIND,
  PIPELINE_MODEL_NAME,
} from "../cleanupStaleAnalysisRuns";
import { fakeSupabase } from "./_fakeSupabase";

const STALE = new Date(Date.now() - 11 * 60 * 1000).toISOString();
const FRESH = new Date(Date.now() - 30 * 1000).toISOString();

function makeStore(rows: any[]) {
  return fakeSupabase({ risk_runs: rows });
}

function captureEvents(): {
  fn: (args: any) => Promise<{ ok: true }>;
  events: any[];
} {
  const events: any[] = [];
  return {
    events,
    fn: async (args: any) => {
      events.push(args);
      return { ok: true };
    },
  };
}

test("reaps running rows older than cutoff with matching model_name", async () => {
  const store = makeStore([
    {
      id: "rr_stale",
      deal_id: "d1",
      status: "running",
      model_name: PIPELINE_MODEL_NAME,
      created_at: STALE,
    },
  ]);
  const { fn, events } = captureEvents();

  const result = await cleanupStaleAnalysisRuns({
    _deps: { sb: store.sb, writeEvent: fn as any },
  });

  assert.equal(result.reaped.length, 1);
  assert.equal(result.reaped[0].riskRunId, "rr_stale");
  assert.equal(result.reaped[0].dealId, "d1");

  const row = store.tables.risk_runs.find((r) => r.id === "rr_stale");
  assert.equal(row?.status, "failed");
  assert.equal(row?.error, STALE_RUN_ERROR);

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, STALE_RUN_EVENT_KIND);
  assert.equal(events[0].dealId, "d1");
  assert.equal(events[0].meta.risk_run_id, "rr_stale");
});

test("does NOT reap fresh running rows (within cutoff)", async () => {
  const store = makeStore([
    {
      id: "rr_fresh",
      deal_id: "d1",
      status: "running",
      model_name: PIPELINE_MODEL_NAME,
      created_at: FRESH,
    },
  ]);
  const { fn, events } = captureEvents();

  const result = await cleanupStaleAnalysisRuns({
    _deps: { sb: store.sb, writeEvent: fn as any },
  });

  assert.equal(result.reaped.length, 0);
  assert.equal(events.length, 0);
  assert.equal(store.tables.risk_runs[0].status, "running");
});

test("does NOT reap rows with a different model_name", async () => {
  const store = makeStore([
    {
      id: "rr_other_model",
      deal_id: "d1",
      status: "running",
      model_name: "some_other_pipeline",
      created_at: STALE,
    },
  ]);
  const { fn, events } = captureEvents();

  const result = await cleanupStaleAnalysisRuns({
    _deps: { sb: store.sb, writeEvent: fn as any },
  });

  assert.equal(result.reaped.length, 0);
  assert.equal(events.length, 0);
});

test("does NOT reap completed or failed rows even when old", async () => {
  const store = makeStore([
    {
      id: "rr_completed",
      deal_id: "d1",
      status: "completed",
      model_name: PIPELINE_MODEL_NAME,
      created_at: STALE,
    },
    {
      id: "rr_failed",
      deal_id: "d1",
      status: "failed",
      model_name: PIPELINE_MODEL_NAME,
      created_at: STALE,
    },
  ]);
  const { fn } = captureEvents();

  const result = await cleanupStaleAnalysisRuns({
    _deps: { sb: store.sb, writeEvent: fn as any },
  });

  assert.equal(result.reaped.length, 0);
});

test("scopes to a specific dealId when provided", async () => {
  const store = makeStore([
    {
      id: "rr_target",
      deal_id: "d1",
      status: "running",
      model_name: PIPELINE_MODEL_NAME,
      created_at: STALE,
    },
    {
      id: "rr_other",
      deal_id: "d2",
      status: "running",
      model_name: PIPELINE_MODEL_NAME,
      created_at: STALE,
    },
  ]);
  const { fn, events } = captureEvents();

  const result = await cleanupStaleAnalysisRuns({
    dealId: "d1",
    _deps: { sb: store.sb, writeEvent: fn as any },
  });

  assert.equal(result.reaped.length, 1);
  assert.equal(result.reaped[0].dealId, "d1");
  assert.equal(events.length, 1);
  // The other deal's stale row was untouched
  const other = store.tables.risk_runs.find((r) => r.id === "rr_other");
  assert.equal(other?.status, "running");
});

test("custom cutoffMs override is honoured", async () => {
  // 30s-old row — fresh by default 10-min cutoff, stale at 5s cutoff
  const store = makeStore([
    {
      id: "rr_30s",
      deal_id: "d1",
      status: "running",
      model_name: PIPELINE_MODEL_NAME,
      created_at: FRESH,
    },
  ]);
  const { fn } = captureEvents();

  const tight = await cleanupStaleAnalysisRuns({
    cutoffMs: 5_000,
    _deps: { sb: store.sb, writeEvent: fn as any },
  });
  assert.equal(tight.reaped.length, 1);
});
