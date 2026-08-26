import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const m = require("../notificationDelivery") as typeof import("../notificationDelivery");
type Row = Record<string, any>;

class S {
  tables: Record<string, Row[]>;
  readFailures = new Set<string>();
  writeFailures = new Set<string>();
  claimConflicts = new Set<string>();
  constructor(i?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_alerts: [], brokerage_alert_subscriptions: [], brokerage_notification_outbox: [], brokerage_alert_events: [], ...i };
  }
  from(t: string) { return new Q(this, t); }
}

class Q {
  db: S; table: string; filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null; _i: Row[] | null = null; _l: number | null = null;
  _range: [number, number] | null = null; _ord: { key: string; asc: boolean } | null = null;
  _insertCommitted = false;
  constructor(db: S, t: string) { this.db = db; this.table = t; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  range(from: number, to: number) { this._range = [from, to]; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    this._i = rows.map(row => ({ id: row.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...row }));
    return this;
  }
  update(u: Row) { this._u = u; return this; }
  single(): Promise<{ data: any; error: any }> {
    if (this._i) { const r = this.commitInsert(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); }
    return Promise.resolve(this.readOne());
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) return Promise.resolve(this.commitUpdate());
    if (this._i) { const r = this.commitInsert(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); }
    return Promise.resolve(this.readOne());
  }
  then(f: any, r?: any) {
    if (this._u) return Promise.resolve(this.commitUpdate()).then(f, r);
    if (this._i) return Promise.resolve(this.commitInsert()).then(f, r);
    if (this.db.readFailures.has(this.table)) return Promise.resolve({ data: null, error: { message: `${this.table}_read_failed` } }).then(f, r);
    return Promise.resolve({ data: this.rows(), error: null }).then(f, r);
  }
  private readOne() {
    if (this.db.readFailures.has(this.table)) return { data: null, error: { message: `${this.table}_read_failed` } };
    return { data: this.rows()[0] ?? null, error: null };
  }
  private commitInsert() {
    if (this.db.writeFailures.has(this.table)) return { data: null, error: { message: `${this.table}_write_failed` } };
    if (!this._insertCommitted) {
      this.db.tables[this.table] ??= [];
      for (const row of this._i ?? []) {
        if (this.table === "brokerage_notification_outbox") {
          row.attempts ??= 0;
          row.last_attempt_at ??= null;
          row.metadata ??= {};
          row.created_at ??= new Date().toISOString();
        }
      }
      this.db.tables[this.table].push(...(this._i ?? []));
      this._insertCommitted = true;
    }
    return { data: this._i, error: null };
  }
  private commitUpdate() {
    if (this.db.writeFailures.has(this.table)) return { data: null, error: { message: `${this.table}_write_failed` } };
    const matched = this.rows();
    const isClaim = this._u?.last_attempt_at && this._u?.attempts != null;
    if (isClaim && matched.some(row => this.db.claimConflicts.has(String(row.id)))) return { data: null, error: null };
    for (const row of matched) Object.assign(row, this._u);
    return { data: matched[0] ?? null, error: null };
  }
  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter(row => row[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter(row => (f.v as any[]).includes(row[f.k]));
      else if (f.t === "is") rows = rows.filter(row => (row[f.k] ?? null) === f.v);
    }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function alertRow(id = "a1", severity = "critical"): Row {
  return { id, alert_key: `key-${id}`, source: "test", severity, status: "active", deal_id: null, title: `Alert ${id}`, message: "Bad", action: "Fix", first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), occurrence_count: 1 };
}
function makeAlert(ov?: Partial<Row>): any {
  return { id: "a1", alertKey: "k1", source: "t", severity: "critical", status: "active", dealId: null, title: "Crit", message: "Bad", action: "Fix", firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), occurrenceCount: 1, ...ov };
}
function sub(id = "s1", channel = "email"): Row {
  return { id, subscriber_email: `${id}@test.com`, severity_filter: "critical", channel, active: true };
}

test("critical creates outbox", async () => {
  const db = new S({ brokerage_alerts: [alertRow()], brokerage_alert_subscriptions: [sub()] });
  assert.equal((await m.buildNotificationOutbox(db as any)).queued, 1);
});
test("suppressed no notify", () => { assert.equal(m.shouldNotifySubscription(makeAlert({ status: "suppressed" }), { severity_filter: "critical", active: true, channel: "email" }, []), false); });
test("warning digest", () => { const { subject, body } = m.buildEmailDigest([makeAlert({ severity: "warning", title: "W1" }), makeAlert({ severity: "warning", title: "W2", id: "a2" })]); assert.ok(subject.includes("warning")); assert.ok(body.includes("W1")); });
test("cooldown blocks matching subscription", () => { assert.equal(m.shouldNotifySubscription(makeAlert(), sub("s1"), [{ alert_id: "a1", subscription_id: "s1", channel: "email", status: "sent", created_at: new Date().toISOString() }]), false); });
test("dashboard immediate", async () => { const db = new S({ brokerage_alerts: [alertRow()], brokerage_alert_subscriptions: [sub("s1", "dashboard")] }); await m.buildNotificationOutbox(db as any); assert.equal(db.tables.brokerage_notification_outbox[0]?.status, "sent"); });
test("failed adapter", async () => { const db = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "o@t.com", subject: "T", body: "B", status: "pending", attempts: 0, last_attempt_at: null }] }); const result = await m.sendPendingNotifications(db as any, { email: async () => ({ ok: false, error: "smtp" }) }); assert.equal(result.failed, 1); assert.equal(db.tables.brokerage_notification_outbox[0].status, "failed"); });
test("retry increments", async () => { const db = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "x", body: "B", status: "pending", attempts: 2 }] }); await m.markNotificationFailed("n1", "err", db as any); assert.equal(db.tables.brokerage_notification_outbox[0].attempts, 3); });
test("email digest subject", () => { const { subject, body } = m.buildEmailDigest([makeAlert()]); assert.ok(subject.includes("CRITICAL")); assert.ok(body.includes("Fix")); });
test("slack concise", () => { const { body } = m.buildSlackDigest([makeAlert()]); assert.ok(body.includes("Critical")); assert.ok(body.length < 500); });
test("body strips secrets", () => { const { body } = m.buildEmailDigest([makeAlert({ title: "token_hash leak rawToken password" })]); assert.ok(!body.includes("token_hash")); assert.ok(!body.includes("rawToken")); });
test("full cycle", async () => { const db = new S({ brokerage_alerts: [alertRow()], brokerage_alert_subscriptions: [sub()] }); const result = await m.runBrokerageNotificationCycle(db as any, { email: async () => ({ ok: true }) }); assert.deepEqual(result, { queued: 1, sent: 1, failed: 0, skipped: 0 }); });

test("cooldown is scoped per subscription", async () => {
  const db = new S({
    brokerage_alerts: [alertRow()],
    brokerage_alert_subscriptions: [sub("s1"), sub("s2")],
    brokerage_notification_outbox: [{ id: "old", alert_id: "a1", subscription_id: "s1", channel: "email", status: "sent", created_at: new Date().toISOString(), metadata: { alert_ids: ["a1"] } }],
  });
  assert.equal((await m.buildNotificationOutbox(db as any)).queued, 1);
  assert.equal(db.tables.brokerage_notification_outbox.at(-1)?.subscription_id, "s2");
});

test("digest provenance suppresses every included alert", async () => {
  const db = new S({ brokerage_alerts: [alertRow("a1"), alertRow("a2")], brokerage_alert_subscriptions: [sub()] });
  assert.equal((await m.buildNotificationOutbox(db as any)).queued, 1);
  assert.deepEqual(db.tables.brokerage_notification_outbox[0].metadata.alert_ids, ["a1", "a2"]);
  assert.equal((await m.buildNotificationOutbox(db as any)).queued, 0);
});

test("outbox construction surfaces every database failure", async () => {
  for (const table of ["brokerage_alerts", "brokerage_alert_subscriptions", "brokerage_notification_outbox"]) {
    const db = new S({ brokerage_alerts: [alertRow()], brokerage_alert_subscriptions: [sub()] });
    db.readFailures.add(table);
    await assert.rejects(() => m.buildNotificationOutbox(db as any), /_read.*read_failed/);
  }
  const db = new S({ brokerage_alerts: [alertRow()], brokerage_alert_subscriptions: [sub()] });
  db.writeFailures.add("brokerage_notification_outbox");
  await assert.rejects(() => m.buildNotificationOutbox(db as any), /outbox_insert.*write_failed/);
});

test("lost claim never invokes provider", async () => {
  const db = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "x", body: "B", status: "pending", attempts: 0, last_attempt_at: null }] });
  db.claimConflicts.add("n1");
  let calls = 0;
  const result = await m.sendPendingNotifications(db as any, { email: async () => { calls++; return { ok: true }; } });
  assert.deepEqual(result, { sent: 0, failed: 0, skipped: 1 });
  assert.equal(calls, 0);
});

test("active lease prevents duplicate provider call", async () => {
  const db = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "x", body: "B", status: "pending", attempts: 1, last_attempt_at: new Date().toISOString() }] });
  let calls = 0;
  const result = await m.sendPendingNotifications(db as any, { email: async () => { calls++; return { ok: true }; } });
  assert.equal(result.skipped, 1);
  assert.equal(calls, 0);
});

test("expired lease recovers and provider exceptions persist safely", async () => {
  const db = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "x", body: "B", status: "pending", attempts: 1, last_attempt_at: new Date(Date.now() - 10 * 60_000).toISOString() }] });
  const result = await m.sendPendingNotifications(db as any, { email: async () => { throw new Error("smtp secret"); } });
  assert.equal(result.failed, 1);
  assert.equal(db.tables.brokerage_notification_outbox[0].attempts, 2);
  assert.equal(db.tables.brokerage_notification_outbox[0].status, "failed");
  assert.equal(db.tables.brokerage_notification_outbox[0].error, "provider_exception");
});

test("delivery read and final transition failures surface", async () => {
  const readDb = new S(); readDb.readFailures.add("brokerage_notification_outbox");
  await assert.rejects(() => m.sendPendingNotifications(readDb as any, {}), /pending_read.*read_failed/);
  const writeDb = new S({ brokerage_notification_outbox: [{ id: "n1", channel: "email", recipient: "x", body: "B", status: "pending", attempts: 0, last_attempt_at: null }] });
  let writes = 0;
  const originalFrom = writeDb.from.bind(writeDb);
  writeDb.from = ((table: string) => { const query = originalFrom(table); const update = query.update.bind(query); query.update = (value: Row) => { writes++; if (writes === 2) writeDb.writeFailures.add(table); return update(value); }; return query; }) as any;
  await assert.rejects(() => m.sendPendingNotifications(writeDb as any, { email: async () => ({ ok: true }) }), /mark_sent.*write_failed/);
});

test("pending scan paginates beyond Supabase default window", async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ id: `n-${String(i).padStart(4, "0")}`, channel: "email", recipient: "x", body: "B", status: "pending", attempts: 0, last_attempt_at: null }));
  const db = new S({ brokerage_notification_outbox: rows });
  const result = await m.sendPendingNotifications(db as any, { email: async () => ({ ok: true }) });
  assert.deepEqual(result, { sent: 1005, failed: 0, skipped: 0 });
});
