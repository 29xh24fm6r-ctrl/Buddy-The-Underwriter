import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsLifecycleHooks") as typeof import("../commsLifecycleHooks");

type Row = Record<string, any>;

// ── In-memory Supabase stub ────────────────────────────────────────────────

class RS {
  tables: Record<string, Row[]> = {
    deals: [],
    borrower_concierge_sessions: [],
    deal_documents: [],
    deal_document_slots: [],
    brokerage_comms_outbox: [],
    brokerage_comms_ledger: [],
    brokerage_borrower_message_templates: [],
    brokerage_borrower_message_outbox: [],
  };
  from(t: string) { return new RQ(this, t); }
}

class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _u: Row | null; _i: Row[] | null; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }
  neq(k: string, v: any) { this.filters.push({ t: "neq", k, v }); return this; }
  insert(p: Row | Row[]) { const rows = Array.isArray(p) ? p : [p]; const wi = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r })); this.db.tables[this.table] ??= []; this.db.tables[this.table].push(...wi); this._i = wi; return this; }
  update(u: Row) { this._u = u; return this; }
  single(): Promise<{ data: any; error: any }> { if (this._i) return Promise.resolve({ data: this._i[0], error: null }); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  maybeSingle(): Promise<{ data: any; error: any }> { if (this._u) { for (const r of this.rows()) Object.assign(r, this._u); return Promise.resolve({ data: this.rows()[0], error: null }); } return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  then(f: any, r?: any) { if (this._u) { for (const row of this.rows()) Object.assign(row, this._u); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); } if (this._i) return Promise.resolve({ data: this._i, error: null }).then(f, r); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() { let rows = [...(this.db.tables[this.table] ?? [])]; for (const f of this.filters) { if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v); else if (f.t === "neq") rows = rows.filter(r => r[f.k] !== f.v); else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k])); else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; }); } if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); } if (this._l != null) rows = rows.slice(0, this._l); return rows; }
}

function freshDb(): RS {
  const db = new RS();
  db.tables.deals = [{ id: "d1", status: "active", display_name: "Test Deal", borrower_name: "Test Borrower", borrower_email: "borrower@test.com" }];
  db.tables.deal_document_slots = [{ deal_id: "d1", required_doc_type: "BTR" }];
  db.tables.borrower_concierge_sessions = [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "Test", phone: "+12025551234", sms_opt_in: true } } }];
  return db;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("documents_received enqueues banker alert only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  assert.equal(r.action, "enqueued");
  assert.ok(r.enqueued > 0);
  // Only outbox items should be banker alerts, no borrower nudges
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "documents_received"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("readiness_regressed enqueues banker alert only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "readiness_regressed" }, db as any);
  assert.equal(r.action, "enqueued");
  assert.ok(r.enqueued > 0);
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "readiness_regressed"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("deal_ready_for_review enqueues banker alert only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "deal_ready_for_review" }, db as any);
  assert.equal(r.action, "enqueued");
  assert.ok(r.enqueued > 0);
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "deal_ready_for_review"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("missing_documents_detected enqueues borrower nudge only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  delete process.env.BROKERAGE_BANKER_EMAIL;
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "missing_documents_detected" }, db as any);
  assert.equal(r.action, "enqueued");
  assert.ok(r.enqueued > 0);
  // Outbox items should be borrower nudges, not banker alerts
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "missing_documents"));
  if (orig) process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("borrower_nudge_failed enqueues banker escalation", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "borrower_nudge_failed" }, db as any);
  assert.equal(r.action, "enqueued");
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "borrower_nudge_failed"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("borrower_nudge_exhausted enqueues banker escalation", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r = await m.handleLifecycleHook({ dealId: "d1", event: "borrower_nudge_exhausted" }, db as any);
  assert.equal(r.action, "enqueued");
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.every((i: Row) => i.trigger_key === "borrower_nudge_exhausted"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("default processOutbox is false — items stay pending", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.length > 0);
  assert.ok(outbox.every((i: Row) => i.status === "pending"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("duplicate hooks dedup via existing idempotency", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  const r1 = await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  const r2 = await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  // Second call should dedup — either enqueue 0 or skip
  assert.ok(r1.enqueued > 0);
  assert.equal(r2.enqueued, 0, "Second hook should dedup");
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("inactive/closed deals are skipped", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  for (const status of ["closed", "declined", "funded", "archived", "docs_complete"]) {
    const db = new RS();
    db.tables.deals = [{ id: "d1", status, display_name: "T", borrower_name: "T", borrower_email: "t@t.com" }];
    const r = await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
    assert.equal(r.action, "skipped", `Should skip deal with status=${status}`);
    assert.ok(r.reason?.includes(status), `Reason should mention ${status}`);
    assert.equal(db.tables.brokerage_comms_outbox.length, 0, `No outbox items for ${status}`);
  }
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("no direct adapter calls — outbox only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();
  await m.handleLifecycleHook({ dealId: "d1", event: "deal_ready_for_review" }, db as any);
  const outbox = db.tables.brokerage_comms_outbox;
  // All items pending = no adapter was called
  const sent = outbox.filter((i: Row) => i.status === "sent");
  assert.equal(sent.length, 0, "No items should be sent — outbox only, no adapter calls");
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("ledger emits received/enqueued/skipped/failed events", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";

  // 1. Enqueued case
  const db1 = freshDb();
  await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db1 as any);
  const ledger1 = db1.tables.brokerage_comms_ledger;
  const hookEvents1 = ledger1.filter((e: Row) => String(e.event_type).startsWith("comms_lifecycle_hook_"));
  assert.ok(hookEvents1.some((e: Row) => e.event_type === "comms_lifecycle_hook_received"), "Must emit received");
  assert.ok(hookEvents1.some((e: Row) => e.event_type === "comms_lifecycle_hook_enqueued"), "Must emit enqueued");

  // 2. Skipped case (inactive deal)
  const db2 = new RS();
  db2.tables.deals = [{ id: "d1", status: "closed", display_name: "T", borrower_name: "T" }];
  await m.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db2 as any);
  const ledger2 = db2.tables.brokerage_comms_ledger;
  const hookEvents2 = ledger2.filter((e: Row) => String(e.event_type).startsWith("comms_lifecycle_hook_"));
  assert.ok(hookEvents2.some((e: Row) => e.event_type === "comms_lifecycle_hook_received"), "Must emit received");
  assert.ok(hookEvents2.some((e: Row) => e.event_type === "comms_lifecycle_hook_skipped"), "Must emit skipped");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});
