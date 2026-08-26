import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const m = require("../lenderComms") as typeof import("../lenderComms");
type Row = Record<string, any>;

class S {
  tables: Record<string, Row[]>;
  readFailures = new Set<string>();
  writeFailures = new Set<string>();
  claimConflicts = new Set<string>();
  constructor(i?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_lender_message_templates: [], brokerage_lender_message_outbox: [], marketplace_listings: [], lender_marketplace_agreements: [], ...i };
  }
  from(t: string) { return new Q(this, t); }
}

class Q {
  db: S; table: string; filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null; _i: Row[] | null = null; _l: number | null = null;
  _ord: { key: string; asc: boolean } | null = null; _range: [number, number] | null = null;
  _insertCommitted = false;
  constructor(db: S, t: string) { this.db = db; this.table = t; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  range(from: number, to: number) { this._range = [from, to]; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }
  insert(p: Row | Row[]) { const rows = Array.isArray(p) ? p : [p]; this._i = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r })); return this; }
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
    if (!this._insertCommitted) { this.db.tables[this.table] ??= []; this.db.tables[this.table].push(...(this._i ?? [])); this._insertCommitted = true; }
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
      if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "is") rows = rows.filter(r => (r[f.k] ?? null) === f.v);
    }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function mdb() { return new S({ marketplace_listings: [{ id: "l1", matched_lender_bank_ids: ["b1", "b2"] }], lender_marketplace_agreements: [{ lender_bank_id: "b1", status: "active", signed_by_email: "l@b.com" }] }); }
test("preview redacted", async () => { const msg = await m.buildLenderMessage("marketplace_preview_open", { lenderBankId: "b1", stage: "preview" }, mdb() as any); const r = m.assertLenderMessageSafe(msg, "preview"); assert.equal(r.safe, true); });
test("matched only", async () => { const r1 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", mdb() as any); assert.equal(r1.ok, true); const r2 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "bX", listingId: "l1", stage: "claim" }, "email", mdb() as any); assert.equal(r2.ok, false); if (!r2.ok) assert.equal(r2.error, "lender_not_matched"); });
test("claim no package link", async () => { const msg = await m.buildLenderMessage("claim_confirmed", { lenderBankId: "b1", stage: "claim" }, mdb() as any); assert.ok(!msg.body.includes("/package/")); });
test("picked only", async () => { const r = await m.queueLenderMessage("borrower_selected_lender", { lenderBankId: "b1", stage: "picked", dealId: "d1" }, "email", mdb() as any); assert.equal(r.ok, true); });
test("non-picked blocked", async () => { const r = await m.queueLenderMessage("package_access_granted", { lenderBankId: "b1", stage: "claim" }, "email", mdb() as any); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error, "trigger_requires_picked_stage"); });
test("package safe URL", async () => { const msg = await m.buildLenderMessage("package_access_granted", { lenderBankId: "b1", accessId: "acc1", stage: "picked" }, mdb() as any); assert.ok(msg.body.includes("/lender/marketplace/package/acc1")); assert.ok(!msg.body.includes("/gcs/")); });
test("condition to lender", async () => { const db = mdb(); const r = await m.queueLenderMessage("condition_requested", { lenderBankId: "b1", stage: "closing", dealId: "d1" }, "dashboard", db as any); assert.equal(r.ok, true); assert.equal(db.tables.brokerage_lender_message_outbox[0]?.status, "sent"); });
test("funding notice", async () => { const db = mdb(); const r = await m.queueLenderMessage("funding_verified", { lenderBankId: "b1", stage: "funded", dealId: "d1" }, "email", db as any); assert.equal(r.ok, true); });
test("cooldown", async () => { const db = mdb(); const r1 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", db as any); const r2 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", db as any); if (r1.ok) assert.equal(r1.suppressed, false); if (r2.ok) assert.equal(r2.suppressed, true); });
test("adapter fail", async () => { const db = mdb(); await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", db as any); const oid = db.tables.brokerage_lender_message_outbox[0].id; const r = await m.sendLenderMessage(oid, async () => ({ ok: false, error: "smtp" }), db as any); assert.equal(r.ok, false); assert.equal(db.tables.brokerage_lender_message_outbox[0].attempts, 1); assert.equal(db.tables.brokerage_lender_message_outbox[0].status, "failed"); });
test("strip secrets", async () => { const db = new S({ brokerage_lender_message_templates: [{ trigger_key: "test_s", channel: "email", status: "active", body_md: "token_hash rawToken password" }], lender_marketplace_agreements: [{ lender_bank_id: "b1", status: "active", signed_by_email: "x@y.com" }] }); const msg = await m.buildLenderMessage("test_s", { lenderBankId: "b1" }, db as any); assert.ok(!msg.body.includes("token_hash")); assert.ok(msg.body.includes("[REDACTED]")); });
test("safety catches PII", () => { const r = m.assertLenderMessageSafe({ body: "borrower_email here" }, "preview"); assert.equal(r.safe, false); assert.ok(r.issues.some(i => i.includes("PII"))); const r2 = m.assertLenderMessageSafe({ body: "A deal is available" }, "preview"); assert.equal(r2.safe, true); });
test("triggers complete", () => { assert.ok(m.LENDER_TRIGGER_KEYS.includes("marketplace_preview_open")); assert.ok(m.LENDER_TRIGGER_KEYS.includes("funding_verified")); assert.ok(m.LENDER_TRIGGER_KEYS.length >= 14); });
test("portal link", () => { assert.equal(m.buildLenderPortalLink({ lenderBankId: "b1", accessId: "a1" }), "/lender/marketplace/package/a1"); assert.equal(m.buildLenderPortalLink({ lenderBankId: "b1" }), "/lender/listings"); });
test("recipient from agreement", async () => { const r = await m.getLenderCommsRecipients("b1", mdb() as any); assert.equal(r[0], "l@b.com"); });

test("listing read failures and missing listings fail closed", async () => {
  const failed = mdb(); failed.readFailures.add("marketplace_listings");
  const r1 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", failed as any);
  assert.deepEqual(r1, { ok: false, error: "listing_read_failed" });
  const missing = mdb(); missing.tables.marketplace_listings = [];
  const r2 = await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "missing", stage: "claim" }, "email", missing as any);
  assert.deepEqual(r2, { ok: false, error: "listing_not_found" });
});

test("recipient, template, and cooldown read failures cannot queue", async () => {
  for (const table of ["lender_marketplace_agreements", "brokerage_lender_message_templates", "brokerage_lender_message_outbox"]) {
    const db = mdb(); db.readFailures.add(table);
    const r = await m.queueLenderMessage("funding_verified", { lenderBankId: "b1", stage: "funded", dealId: "d1" }, "email", db as any);
    assert.equal(r.ok, false, table);
  }
});

test("email without an authorized lender recipient is rejected", async () => {
  const db = mdb(); db.tables.lender_marketplace_agreements = [];
  const r = await m.queueLenderMessage("funding_verified", { lenderBankId: "b1", stage: "funded", dealId: "d1" }, "email", db as any);
  assert.deepEqual(r, { ok: false, error: "lender_recipient_missing" });
});

test("lost compare-and-set claim never invokes the provider", async () => {
  const db = mdb();
  await m.queueLenderMessage("claim_window_open", { lenderBankId: "b1", listingId: "l1", stage: "claim" }, "email", db as any);
  const id = String(db.tables.brokerage_lender_message_outbox[0].id); db.claimConflicts.add(id);
  let calls = 0;
  const r = await m.sendLenderMessage(id, async () => { calls++; return { ok: true }; }, db as any);
  assert.deepEqual(r, { ok: false, error: "not_claimed" });
  assert.equal(calls, 0);
});

test("active claim lease prevents duplicate delivery", async () => {
  const db = mdb(); db.tables.brokerage_lender_message_outbox.push({ id: "leased", status: "pending", attempts: 1, last_attempt_at: new Date().toISOString(), channel: "email", recipient: "x@y.com", body: "B" });
  let calls = 0; const r = await m.sendLenderMessage("leased", async () => { calls++; return { ok: true }; }, db as any);
  assert.equal(r.error, "not_claimed"); assert.equal(calls, 0);
});

test("expired lease is recovered and provider exception is persisted", async () => {
  const db = mdb(); db.tables.brokerage_lender_message_outbox.push({ id: "expired", status: "pending", attempts: 1, last_attempt_at: new Date(Date.now() - 10 * 60_000).toISOString(), channel: "email", recipient: "x@y.com", body: "B" });
  const r = await m.sendLenderMessage("expired", async () => { throw new Error("smtp secret"); }, db as any);
  assert.deepEqual(r, { ok: false, error: "provider_exception" });
  assert.equal(db.tables.brokerage_lender_message_outbox[0].status, "failed");
  assert.equal(db.tables.brokerage_lender_message_outbox[0].attempts, 2);
});

test("final transition failure surfaces after provider success", async () => {
  const db = mdb(); db.tables.brokerage_lender_message_outbox.push({ id: "n1", status: "pending", attempts: 0, last_attempt_at: null, channel: "email", recipient: "x@y.com", body: "B" });
  let writes = 0;
  const originalFrom = db.from.bind(db);
  db.from = ((table: string) => { const q = originalFrom(table); const originalUpdate = q.update.bind(q); q.update = (u: Row) => { writes++; if (writes === 2) db.writeFailures.add(table); return originalUpdate(u); }; return q; }) as any;
  await assert.rejects(() => m.sendLenderMessage("n1", async () => ({ ok: true }), db as any), /mark_sent.*write_failed/);
});

test("cycle surfaces database read failure", async () => {
  const db = mdb(); db.readFailures.add("brokerage_lender_message_outbox");
  await assert.rejects(() => m.runLenderCommsCycle(db as any), /cycle_read.*read_failed/);
});

test("cycle paginates beyond the Supabase default result window", async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ id: `n-${String(i).padStart(4, "0")}`, status: "pending", attempts: 0, last_attempt_at: null, channel: "email", recipient: "x@y.com", body: "B" }));
  const db = new S({ brokerage_lender_message_outbox: rows });
  const r = await m.runLenderCommsCycle(db as any, async () => ({ ok: true }));
  assert.deepEqual(r, { queued: 1005, sent: 1005, failed: 0, skipped: 0 });
});
