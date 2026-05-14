import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsOutbox") as typeof import("../commsOutbox");

type Row = Record<string, any>;

class OS {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_comms_outbox: [], brokerage_comms_ledger: [], ...init };
  }
  from(t: string) { return new OQ(this, t); }
}

class OQ {
  db: OS; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _u: Row | null; _i: Row[] | null; _l: number | null;
  _ord: { key: string; asc: boolean } | null;

  constructor(db: OS, t: string) {
    this.db = db; this.table = t;
    this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null;
  }

  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  neq(k: string, v: any) { this.filters.push({ t: "neq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }

  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    const wi = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...wi);
    this._i = wi; return this;
  }

  update(u: Row) { this._u = u; return this; }

  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) { for (const r of this.rows()) Object.assign(r, this._u); return Promise.resolve({ data: this.rows()[0], error: null }); }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(f: any, r?: any) {
    if (this._u) { for (const row of this.rows()) Object.assign(row, this._u); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
    if (this._i) return Promise.resolve({ data: this._i, error: null }).then(f, r);
    return Promise.resolve({ data: this.rows(), error: null }).then(f, r);
  }

  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v);
      else if (f.t === "neq") rows = rows.filter(r => r[f.k] !== f.v);
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; });
    }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

const BASE_ARGS = { idempotencyKey: "test-key-1", channel: "email" as const, provider: "resend" as const, recipient: "test@example.com", body: "Hello", dealId: "deal-1", triggerKey: "funded" };

// ── Enqueue ─────────────────────────────────────────────────────────────────

test("enqueue creates pending item", async () => {
  const db = new OS();
  const r = await m.enqueueCommsMessage(BASE_ARGS, db as any);
  assert.equal(r.created, true);
  assert.ok(r.id);
  assert.equal(db.tables.brokerage_comms_outbox.length, 1);
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "pending");
  assert.equal(db.tables.brokerage_comms_outbox[0].attempt_count, 0);
});

test("duplicate idempotency key does not duplicate", async () => {
  const db = new OS();
  const r1 = await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const r2 = await m.enqueueCommsMessage(BASE_ARGS, db as any);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(r1.id, r2.id);
  assert.equal(db.tables.brokerage_comms_outbox.length, 1);
});

// ── Claim ───────────────────────────────────────────────────────────────────

test("due pending item is claimed", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const items = await m.claimDueCommsMessages(db as any);
  assert.equal(items.length, 1);
  assert.equal(items[0].channel, "email");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "sending");
});

test("future next_attempt_at is not claimed", async () => {
  const db = new OS({
    brokerage_comms_outbox: [{
      id: "future-1", idempotency_key: "fut", channel: "email", provider: "resend",
      recipient: "x@y.com", body: "hi", status: "pending", attempt_count: 0,
      max_attempts: 3, next_attempt_at: new Date(Date.now() + 60000).toISOString(),
    }],
  });
  const items = await m.claimDueCommsMessages(db as any);
  assert.equal(items.length, 0);
});

// ── Process ─────────────────────────────────────────────────────────────────

test("successful send marks sent", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const items = await m.claimDueCommsMessages(db as any);
  const adapter = async () => ({ ok: true, providerMessageId: "msg-123" } as any);
  const outcome = await m.processCommsOutboxItem(items[0], adapter, db as any);
  assert.equal(outcome, "sent");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "sent");
  assert.equal(db.tables.brokerage_comms_outbox[0].provider_message_id, "msg-123");
});

test("retryable failure schedules retry", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const items = await m.claimDueCommsMessages(db as any);
  const adapter = async () => ({ ok: false, error: "Telnyx 429", retryable: true } as any);
  const outcome = await m.processCommsOutboxItem(items[0], adapter, db as any);
  assert.equal(outcome, "retry_scheduled");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "retry_scheduled");
  assert.equal(db.tables.brokerage_comms_outbox[0].attempt_count, 1);
  assert.ok(db.tables.brokerage_comms_outbox[0].next_attempt_at);
});

test("max attempts marks exhausted", async () => {
  const db = new OS({
    brokerage_comms_outbox: [{
      id: "exh-1", idempotency_key: "exh", channel: "email", provider: "resend",
      recipient: "x@y.com", body: "hi", status: "sending", attempt_count: 2,
      max_attempts: 3, next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    }],
  });
  const item = { ...db.tables.brokerage_comms_outbox[0], idempotencyKey: "exh", attemptCount: 2, maxAttempts: 3, subject: null, dealId: null, triggerKey: null, lastFailureCode: null, providerMessageId: null } as any;
  const adapter = async () => ({ ok: false, error: "Resend 503", retryable: true } as any);
  const outcome = await m.processCommsOutboxItem(item, adapter, db as any);
  assert.equal(outcome, "exhausted");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "exhausted");
});

test("non-retryable failure marks failed", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const items = await m.claimDueCommsMessages(db as any);
  const adapter = async () => ({ ok: false, error: "Invalid E.164", retryable: false } as any);
  const outcome = await m.processCommsOutboxItem(items[0], adapter, db as any);
  assert.equal(outcome, "failed");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "failed");
});

test("already sent item is no-op", async () => {
  const db = new OS({
    brokerage_comms_outbox: [{
      id: "sent-1", idempotency_key: "s", channel: "email", provider: "resend",
      recipient: "x@y.com", body: "hi", status: "sent", attempt_count: 1,
      max_attempts: 3, provider_message_id: "msg-1",
    }],
  });
  const item = { ...db.tables.brokerage_comms_outbox[0], idempotencyKey: "s", attemptCount: 1, maxAttempts: 3, subject: null, dealId: null, triggerKey: null, lastFailureCode: null, providerMessageId: "msg-1" } as any;
  const adapter = async () => { throw new Error("should not be called"); };
  const outcome = await m.processCommsOutboxItem(item, adapter, db as any);
  assert.equal(outcome, "skipped");
});

test("sending lock prevents double-processing", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  // First claim
  const items1 = await m.claimDueCommsMessages(db as any);
  assert.equal(items1.length, 1);
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "sending");
  // Second claim should find nothing (status is now "sending")
  const items2 = await m.claimDueCommsMessages(db as any);
  assert.equal(items2.length, 0);
});

// ── Ledger integration ──────────────────────────────────────────────────────

test("ledger events emitted during processing", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const items = await m.claimDueCommsMessages(db as any);
  const adapter = async () => ({ ok: true, providerMessageId: "msg-456" } as any);
  await m.processCommsOutboxItem(items[0], adapter, db as any);

  const events = db.tables.brokerage_comms_ledger;
  assert.ok(events.length >= 2, `Expected >= 2 ledger events, got ${events.length}`);
  const types = events.map((e: Row) => e.event_type);
  assert.ok(types.includes("brokerage_comms_send_requested"));
  assert.ok(types.includes("brokerage_comms_send_succeeded"));
});

// ── Batch processor ─────────────────────────────────────────────────────────

test("batch processor sends due items", async () => {
  const db = new OS();
  await m.enqueueCommsMessage({ ...BASE_ARGS, idempotencyKey: "b1" }, db as any);
  await m.enqueueCommsMessage({ ...BASE_ARGS, idempotencyKey: "b2", channel: "sms", provider: "telnyx", recipient: "+12025551234" }, db as any);

  const result = await m.processDueCommsOutbox(db as any, () => async () => ({ ok: true, providerMessageId: "p" }));
  assert.equal(result.processed, 2);
  assert.equal(result.sent, 2);
  assert.equal(result.retried, 0);
});
