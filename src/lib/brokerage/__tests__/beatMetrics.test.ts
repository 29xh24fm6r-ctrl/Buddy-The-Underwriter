/**
 * SPEC-M2 BEAT-METRICS-1 — beatMetrics.ts emitter unit tests.
 * Same in-memory fake-Supabase harness as conversionFunnel.test.ts (this
 * module wraps), so no network/env dependency.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const m = require("../beatMetrics") as typeof import("../beatMetrics");

type Row = Record<string, any>;
class S {
  tables: Record<string, Row[]>;
  constructor(i?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_conversion_events: [], borrower_fact_requests: [], ...i };
  }
  from(t: string) {
    return new Q(this, t);
  }
}
class Q {
  db: S;
  table: string;
  _i: Row[] | null;
  constructor(db: S, t: string) {
    this.db = db;
    this.table = t;
    this._i = null;
  }
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    const wi = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...wi);
    this._i = wi;
    return this;
  }
  then(f: any, r?: any) {
    return Promise.resolve({ data: this._i, error: null }).then(f, r);
  }
}

test("emitFirstInteraction writes a first_interaction event with the deal_id", async () => {
  const db = new S();
  await m.emitFirstInteraction("deal-1", db as any);
  const rows = db.tables.brokerage_conversion_events;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, "first_interaction");
  assert.equal(rows[0].deal_id, "deal-1");
});

test("emitReadinessReadRendered writes a readiness_read_rendered event", async () => {
  const db = new S();
  await m.emitReadinessReadRendered("deal-2", db as any);
  assert.equal(db.tables.brokerage_conversion_events[0].event_type, "readiness_read_rendered");
});

test("emitFormlessStart carries the formless flag in metadata", async () => {
  const db = new S();
  await m.emitFormlessStart("deal-3", false, db as any);
  const row = db.tables.brokerage_conversion_events[0];
  assert.equal(row.event_type, "formless_start");
  assert.deepEqual(row.metadata, { formless: false });
});

test("emitFormlessStart(true) records true", async () => {
  const db = new S();
  await m.emitFormlessStart("deal-4", true, db as any);
  assert.equal(db.tables.brokerage_conversion_events[0].metadata.formless, true);
});

test("recordFactRequest writes to borrower_fact_requests, not the events table", async () => {
  const db = new S();
  await m.recordFactRequest("deal-5", "annual_revenue", "interviewer", db as any);
  assert.equal(db.tables.borrower_fact_requests.length, 1);
  assert.equal(db.tables.brokerage_conversion_events.length, 0);
  const row = db.tables.borrower_fact_requests[0];
  assert.equal(row.deal_id, "deal-5");
  assert.equal(row.fact_key, "annual_revenue");
  assert.equal(row.source, "interviewer");
});

test("recordFactRequest called twice for the same (deal, fact) writes two rows (repeat-ask signal)", async () => {
  const db = new S();
  await m.recordFactRequest("deal-6", "ssn", "interviewer", db as any);
  await m.recordFactRequest("deal-6", "ssn", "interviewer", db as any);
  const rows = db.tables.borrower_fact_requests.filter(
    (r) => r.deal_id === "deal-6" && r.fact_key === "ssn",
  );
  assert.equal(rows.length, 2);
});

test("emitDocRequestRound carries itemCount in metadata", async () => {
  const db = new S();
  await m.emitDocRequestRound("deal-7", 3, db as any);
  const row = db.tables.brokerage_conversion_events[0];
  assert.equal(row.event_type, "doc_request_round");
  assert.equal(row.metadata.itemCount, 3);
});

test("emitLenderFollowup with a note stores it in metadata", async () => {
  const db = new S();
  await m.emitLenderFollowup("deal-8", "lender asked for updated PFS", db as any);
  const row = db.tables.brokerage_conversion_events[0];
  assert.equal(row.event_type, "lender_followup");
  assert.equal(row.metadata.note, "lender asked for updated PFS");
});

test("emitLenderFollowup with no note stores empty metadata", async () => {
  const db = new S();
  await m.emitLenderFollowup("deal-9", undefined, db as any);
  assert.deepEqual(db.tables.brokerage_conversion_events[0].metadata, {});
});
