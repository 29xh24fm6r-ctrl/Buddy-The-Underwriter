/**
 * Phase 14A — Batch latest-event endpoint tests.
 *
 * Locks the safety + dedupe + cap contract of
 * /api/brokerage/deals/timeline/latest by exercising the pure helper
 * (dealTimelineBatch.ts). Mirrors the in-memory Supabase stub used by
 * other timeline tests so getDealTimeline runs end-to-end.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const batch = require("../dealTimelineBatch") as typeof import("../dealTimelineBatch");

type Row = Record<string, any>;

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

class RS {
  tables: Record<string, Row[]> = {
    deal_events: [],
    deal_pipeline_ledger: [],
    deal_timeline_events: [],
    brokerage_comms_ledger: [],
    brokerage_comms_outbox: [],
  };
  writes: string[] = [];
  reads: string[] = [];
  from(t: string) { this.reads.push(t); return new RQ(this, t); }
}

class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  insert() { this.db.writes.push(`insert:${this.table}`); throw new Error("write attempted"); }
  update() { this.db.writes.push(`update:${this.table}`); throw new Error("write attempted"); }
  delete() { this.db.writes.push(`delete:${this.table}`); throw new Error("write attempted"); }
  upsert() { this.db.writes.push(`upsert:${this.table}`); throw new Error("write attempted"); }
  then(f: any, r?: any) { return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
    }
    if (this._ord) {
      const { key, asc } = this._ord;
      rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1);
    }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function seedTwoDeals(): RS {
  const db = new RS();
  db.tables.deal_events = [
    { id: "e1", deal_id: "deal-a", kind: "document.uploaded", payload: { source: "borrower", original_filename: "tax.pdf", document_id: "doc-1" }, created_at: "2026-05-14T10:00:00Z" },
    { id: "e2", deal_id: "deal-a", kind: "intake.classified", payload: {}, created_at: "2026-05-13T09:00:00Z" },
    { id: "e3", deal_id: "deal-b", kind: "ready_reverted", payload: { reason: "Checklist incomplete" }, created_at: "2026-05-14T11:30:00Z" },
  ];
  db.tables.brokerage_comms_outbox = [
    { id: "o1", channel: "email", status: "sent", recipient: "john.doe@example.com", trigger_key: "documents_received", deal_id: "deal-a", attempt_count: 1, created_at: "2026-05-14T13:00:00Z" },
  ];
  return db;
}

test("parseDealIdsParam: trims/splits/dedupes, ignores invalid IDs", () => {
  const { ids } = batch.parseDealIdsParam("a, b ,  c , a, , b");
  assert.deepEqual(ids, ["a", "b", "c"]);
  const { ids: clean } = batch.parseDealIdsParam("ok-1, ok_2, ../etc/passwd, ok-3, ' OR 1=1; --");
  assert.deepEqual(clean, ["ok-1", "ok_2", "ok-3"]);
  assert.deepEqual(batch.parseDealIdsParam(null).ids, []);
  assert.deepEqual(batch.parseDealIdsParam("").ids, []);
});

test("parseDealIdsParam: caps at 50 and reports truncation", () => {
  const tokens = Array.from({ length: 75 }, (_, i) => `deal-${i}`).join(",");
  const { ids, requested, truncated } = batch.parseDealIdsParam(tokens);
  assert.equal(ids.length, batch.MAX_BATCH_DEAL_IDS);
  assert.equal(batch.MAX_BATCH_DEAL_IDS, 50);
  assert.equal(requested, 75);
  assert.equal(truncated, true);
  const { truncated: trunc2 } = batch.parseDealIdsParam("ok-1, ok-2, ok-3");
  assert.equal(trunc2, false);
});

test("batchLatestTimelineEvents: one logical request for many deals (5 reads per deal)", async () => {
  const db = seedTwoDeals();
  const result = await batch.batchLatestTimelineEvents("deal-a,deal-b", db as any);
  assert.equal(result.accepted, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(db.reads.length, 5 * 2);
  for (const t of db.reads) {
    assert.ok([
      "deal_events", "deal_pipeline_ledger", "deal_timeline_events",
      "brokerage_comms_ledger", "brokerage_comms_outbox",
    ].includes(t), `Unexpected table read: ${t}`);
  }
});

test("batchLatestTimelineEvents: deduplicates dealIds before fanning out", async () => {
  const db = seedTwoDeals();
  const result = await batch.batchLatestTimelineEvents("deal-a, deal-b, deal-a, deal-b", db as any);
  assert.equal(result.accepted, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(db.reads.length, 5 * 2, "Must NOT redo source reads for duplicate IDs");
});

test("batchLatestTimelineEvents: cap forces no more than 50 fan-outs", async () => {
  const db = new RS();
  for (let i = 0; i < 60; i++) {
    db.tables.deal_events.push({ id: `e${i}`, deal_id: `deal-${i}`, kind: "document.uploaded", payload: {}, created_at: `2026-05-14T${String(i % 24).padStart(2, "0")}:00:00Z` });
  }
  const tokens = Array.from({ length: 60 }, (_, i) => `deal-${i}`).join(",");
  const result = await batch.batchLatestTimelineEvents(tokens, db as any);
  assert.equal(result.accepted, 50);
  assert.equal(result.entries.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(db.reads.length, 5 * 50, "Must not fan out beyond the cap");
});

test("batchLatestTimelineEvents: invalid IDs are silently ignored", async () => {
  const db = seedTwoDeals();
  const result = await batch.batchLatestTimelineEvents("deal-a, ../etc/passwd, '; drop table--, deal-b", db as any);
  assert.equal(result.requested, 4);
  assert.equal(result.accepted, 2);
  assert.deepEqual(result.entries.map((e) => e.dealId), ["deal-a", "deal-b"]);
});

test("batchLatestTimelineEvents: secrets are redacted in the returned events", async () => {
  const db = new RS();
  db.tables.deal_events = [{
    id: "e1", deal_id: "deal-a", kind: "comms_error",
    payload: {
      RESEND_API_KEY: "re_supersecretkey12345",
      auth: "Bearer ya29.A0AfH6SMBxyz123",
      webhook_url: "https://hooks.slack.com/services/T00/B00/secret",
    },
    created_at: "2026-05-14T10:00:00Z",
  }];
  const result = await batch.batchLatestTimelineEvents("deal-a", db as any);
  const json = JSON.stringify(result);
  assert.ok(!json.includes("re_supersecretkey12345"));
  assert.ok(!json.includes("ya29.A0AfH6SMBxyz123"));
  assert.ok(!json.includes("hooks.slack.com/services/T00"));
});

test("batchLatestTimelineEvents: recipients are masked", async () => {
  const db = new RS();
  db.tables.brokerage_comms_outbox = [
    { id: "o1", channel: "email", status: "sent", recipient: "john.doe.fullname@example.com", trigger_key: "documents_received", deal_id: "deal-a", attempt_count: 1, created_at: "2026-05-14T10:00:00Z" },
    { id: "o2", channel: "sms", status: "sent", recipient: "+12025551234", trigger_key: "t2", deal_id: "deal-b", attempt_count: 1, created_at: "2026-05-14T10:01:00Z" },
  ];
  const result = await batch.batchLatestTimelineEvents("deal-a,deal-b", db as any);
  const json = JSON.stringify(result);
  assert.ok(!json.includes("john.doe.fullname@example.com"));
  assert.ok(!json.includes("+12025551234"));
});

test("batchLatestTimelineEvents: raw message bodies are not present", async () => {
  const db = new RS();
  db.tables.deal_events = [{
    id: "e1", deal_id: "deal-a", kind: "comms_sent",
    payload: {
      body: "Dear borrower, please submit your tax returns by Friday.",
      emailBody: "<html>SECRET CONTENT</html>",
      smsBody: "Your verification code is 123456",
    },
    created_at: "2026-05-14T10:00:00Z",
  }];
  const result = await batch.batchLatestTimelineEvents("deal-a", db as any);
  const json = JSON.stringify(result);
  assert.ok(!json.includes("Dear borrower"));
  assert.ok(!json.includes("SECRET CONTENT"));
  assert.ok(!json.includes("verification code"));
});

test("batchLatestTimelineEvents: no writes anywhere", async () => {
  const db = seedTwoDeals();
  await batch.batchLatestTimelineEvents("deal-a,deal-b", db as any);
  assert.equal(db.writes.length, 0);
  const src = read("src/lib/brokerage/dealTimelineBatch.ts");
  assert.ok(!src.includes(".insert("));
  assert.ok(!src.includes(".update("));
  assert.ok(!src.includes(".delete("));
  assert.ok(!src.includes(".upsert("));
});

test("batchLatestTimelineEvents: helper queries through getDealTimeline only", () => {
  const src = read("src/lib/brokerage/dealTimelineBatch.ts");
  assert.ok(src.includes("getDealTimeline"));
  assert.ok(!/\bsb\.from\(/.test(src));
  for (const t of ["deal_events", "deal_pipeline_ledger", "deal_timeline_events", "brokerage_comms_ledger", "brokerage_comms_outbox"]) {
    assert.ok(!src.includes(`"${t}"`), `Must not reference source table ${t} directly`);
  }
});

test("batch route: GET /api/brokerage/deals/timeline/latest exists and is auth-gated", () => {
  const src = read("src/app/api/brokerage/deals/timeline/latest/route.ts");
  assert.ok(src.includes("export async function GET"));
  assert.ok(src.includes("requireBrokerageCommsAdmin"));
  assert.ok(src.includes("batchLatestTimelineEvents"));
  assert.ok(src.includes("redactResponseSecrets"));
  assert.ok(!src.includes(".insert("));
  assert.ok(!src.includes(".update("));
  assert.ok(!src.includes(".delete("));
  assert.ok(!src.includes(".upsert("));
  for (const t of ["deal_events", "deal_pipeline_ledger", "deal_timeline_events", "brokerage_comms_ledger", "brokerage_comms_outbox"]) {
    assert.ok(!src.includes(`"${t}"`), `Route must not reference source table ${t}`);
  }
});
