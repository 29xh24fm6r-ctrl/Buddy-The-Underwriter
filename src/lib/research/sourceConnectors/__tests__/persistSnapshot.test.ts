import { test } from "node:test";
import assert from "node:assert/strict";

import { persistManualSourceSnapshot } from "../persistSnapshot";

/**
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B — the shared persist-core fetches +
 * inserts a snapshot and advances the task workflow, NEVER setting
 * committee_grade_accepted / review_status / resolved_status.
 */

function mockResponse(status: number, html: string, contentType = "text/html") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    body: null,
    text: async () => html,
  } as unknown as Response;
}

function fakeSb(captured: { inserts: any[]; updates: any[] }) {
  const make = () => {
    const ctx: { op: string | null; payload: any } = { op: null, payload: null };
    const b: any = {
      insert(row: any) { ctx.op = "insert"; ctx.payload = row; captured.inserts.push(row); return b; },
      update(row: any) { ctx.op = "update"; ctx.payload = row; captured.updates.push(row); return b; },
      select() { return b; },
      eq() { return b; },
      order() { return b; },
      limit() { return b; },
      async maybeSingle() {
        if (ctx.op === "insert") return { data: { id: "snap-1", status: ctx.payload.status, ...ctx.payload }, error: null };
        if (ctx.op === "update") return { data: { id: "task-1", status: ctx.payload.status ?? "collected", review_status: null, committee_grade_accepted: false, resolved_status: ctx.payload.resolved_status ?? null }, error: null };
        return { data: null, error: null };
      },
    };
    return b;
  };
  return { from: () => make() } as any;
}

test("[persist] collected snapshot is inserted and task advanced pending→collected, no committee_grade write", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => mockResponse(200, "<title>Census NAICS 561422</title><p>data</p>")) as any;
  const captured = { inserts: [] as any[], updates: [] as any[] };
  try {
    const r = await persistManualSourceSnapshot(fakeSb(captured), {
      dealId: "deal-1",
      task: { id: "task-1", mission_id: "m-1", deal_id: "deal-1", status: "pending" },
      connectorKind: "trade_or_market_source",
      sourceUrl: "https://data.census.gov/cedsci/all?q=NAICS%20561422",
      sourceType: "government_data",
      candidateMetadata: { decision_area: "Industry Validation", naics_code: "561422" },
    });
    assert.equal(r.ok, true);
    assert.equal((r.snapshot as any).status, "collected");
    // snapshot row carries the connector + source classification.
    assert.equal(captured.inserts[0].source_type, "government_data");
    assert.equal(captured.inserts[0].connector_kind, "trade_or_market_source");
    // task advanced to collected, with the snapshot linked.
    const taskUpdate = captured.updates.find((u) => u.status === "collected");
    assert.ok(taskUpdate, "task advanced to collected");
    assert.equal(taskUpdate.source_snapshot_id, "snap-1");
    // INVARIANT: no committee_grade_accepted / review_status written by persist.
    for (const u of captured.updates) {
      assert.equal("committee_grade_accepted" in u, false);
      assert.equal("review_status" in u, false);
    }
  } finally {
    globalThis.fetch = orig;
  }
});

test("[persist] a failed fetch does not advance the task to collected", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => mockResponse(503, "down")) as any;
  const captured = { inserts: [] as any[], updates: [] as any[] };
  try {
    const r = await persistManualSourceSnapshot(fakeSb(captured), {
      dealId: "deal-1",
      task: { id: "task-1", mission_id: "m-1", deal_id: "deal-1", status: "pending" },
      connectorKind: "trade_or_market_source",
      sourceUrl: "https://data.census.gov/cedsci/all?q=NAICS%20561422",
      sourceType: "government_data",
    });
    assert.equal(r.ok, true); // row still inserted (status failed)
    assert.equal((r.snapshot as any).status, "failed");
    assert.equal(captured.updates.some((u) => u.status === "collected"), false);
  } finally {
    globalThis.fetch = orig;
  }
});
