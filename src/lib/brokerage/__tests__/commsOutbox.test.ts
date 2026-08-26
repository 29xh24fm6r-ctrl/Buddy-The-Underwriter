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
  readFailures = new Set<string>();
  insertFailures = new Set<string>();
  updateFailures = new Set<string>();
  claimConflicts = new Set<string>();

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
  _insertCommitted = false;

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
    this._i = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    return this;
  }

  update(u: Row) { this._u = u; return this; }

  single(): Promise<{ data: any; error: any }> {
    if (this._i) {
      const result = this.commitInsert();
      return Promise.resolve({
        data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
        error: result.error,
      });
    }
    if (this.db.readFailures.has(this.table)) return Promise.resolve({ data: null, error: { message: `${this.table}_read_failed` } });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) return Promise.resolve(this.commitUpdate());
    if (this.db.readFailures.has(this.table)) return Promise.resolve({ data: null, error: { message: `${this.table}_read_failed` } });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(f: any, r?: any) {
    if (this._u) return Promise.resolve(this.commitUpdate()).then(f, r);
    if (this._i) return Promise.resolve(this.commitInsert()).then(f, r);
    if (this.db.readFailures.has(this.table)) {
      return Promise.resolve({ data: null, error: { message: `${this.table}_read_failed` } }).then(f, r);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(f, r);
  }

  private commitInsert(): { data: any; error: any } {
    if (this.db.insertFailures.has(this.table)) {
      return { data: null, error: { message: `${this.table}_insert_failed` } };
    }
    if (!this._insertCommitted) {
      this.db.tables[this.table] ??= [];
      this.db.tables[this.table].push(...(this._i ?? []));
      this._insertCommitted = true;
    }
    return { data: this._i, error: null };
  }

  private commitUpdate(): { data: any; error: any } {
    if (this.db.updateFailures.has(this.table)) {
      return { data: null, error: { message: `${this.table}_update_failed` } };
    }
    const matched = this.rows();
    const isClaim = this._u?.status === "sending";
    if (isClaim && matched.some(row => this.db.claimConflicts.has(String(row.id)))) {
      return { data: null, error: null };
    }
    for (const row of matched) Object.assign(row, this._u);
    return { data: matched[0] ?? null, error: null };
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

test("lost compare-and-set claim is never returned to a sender", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const id = String(db.tables.brokerage_comms_outbox[0].id);
  db.claimConflicts.add(id);

  const items = await m.claimDueCommsMessages(db as any);
  assert.equal(items.length, 0);
});

test("expired sending lease is reclaimed while an active lease is skipped", async () => {
  const db = new OS({
    brokerage_comms_outbox: [
      {
        id: "stale-claim", idempotency_key: "stale", channel: "email", provider: "resend",
        recipient: "stale@example.com", body: "stale", status: "sending", attempt_count: 1,
        max_attempts: 3, next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      },
      {
        id: "active-claim", idempotency_key: "active", channel: "email", provider: "resend",
        recipient: "active@example.com", body: "active", status: "sending", attempt_count: 1,
        max_attempts: 3, next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });

  const items = await m.claimDueCommsMessages(db as any);
  assert.deepEqual(items.map(item => item.id), ["stale-claim"]);
  assert.equal(items[0].status, "sending");
  assert.ok(new Date(items[0].nextAttemptAt!).getTime() > Date.now());
});

test("claim read failure is surfaced instead of reporting an empty queue", async () => {
  const db = new OS();
  db.readFailures.add("brokerage_comms_outbox");
  await assert.rejects(
    () => m.claimDueCommsMessages(db as any),
    /claim_read: brokerage_comms_outbox_read_failed/,
  );
});

test("adapter exception becomes a durable retry instead of abandoning the claim", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const [item] = await m.claimDueCommsMessages(db as any);

  const outcome = await m.processCommsOutboxItem(
    item,
    async () => { throw new Error("provider_transport_failed"); },
    db as any,
  );

  assert.equal(outcome, "retry_scheduled");
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "retry_scheduled");
  assert.equal(db.tables.brokerage_comms_outbox[0].attempt_count, 1);
});

test("ledger failure prevents provider invocation and leaves the leased row recoverable", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const [item] = await m.claimDueCommsMessages(db as any);
  db.insertFailures.add("brokerage_comms_ledger");
  let providerCalls = 0;

  await assert.rejects(
    () => m.processCommsOutboxItem(item, async () => {
      providerCalls++;
      return { ok: true };
    }, db as any),
    /comms-ledger.*write_failed/,
  );

  assert.equal(providerCalls, 0);
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "sending");
});

test("state-transition failure is surfaced after a provider success", async () => {
  const db = new OS();
  await m.enqueueCommsMessage(BASE_ARGS, db as any);
  const [item] = await m.claimDueCommsMessages(db as any);
  db.updateFailures.add("brokerage_comms_outbox");

  await assert.rejects(
    () => m.processCommsOutboxItem(item, async () => ({ ok: true, providerMessageId: "provider-1" }), db as any),
    /mark_sent: brokerage_comms_outbox_update_failed/,
  );

  assert.equal(db.tables.brokerage_comms_outbox[0].status, "sending");
});

test("only a claimed sending row may reach a provider", async () => {
  const db = new OS();
  const pending = {
    id: "pending-1", idempotencyKey: "pending", channel: "email" as const, provider: "resend" as const,
    recipient: "x@y.com", subject: null, body: "hi", dealId: null, triggerKey: null,
    status: "pending" as const, attemptCount: 0, maxAttempts: 3, nextAttemptAt: null,
    lastFailureCode: null, providerMessageId: null,
  };
  let calls = 0;
  const outcome = await m.processCommsOutboxItem(pending, async () => {
    calls++;
    return { ok: true };
  }, db as any);

  assert.equal(outcome, "skipped");
  assert.equal(calls, 0);
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
