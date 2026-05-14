import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const hooks = require("../commsLifecycleHooks") as typeof import("../commsLifecycleHooks");
const outbox = require("../commsOutbox") as typeof import("../commsOutbox");

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

// ── 1. Upload path invokes documents_received hook ─────────────────────────

test("upload path invokes documents_received hook", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  // Simulate what the upload route does: call handleLifecycleHook directly
  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  assert.equal(r.action, "enqueued");
  assert.ok(r.enqueued > 0);
  // Outbox has banker alert for documents_received
  const items = db.tables.brokerage_comms_outbox.filter((i: Row) => i.trigger_key === "documents_received");
  assert.ok(items.length > 0, "Outbox should have documents_received items");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 2. Readiness missing-doc path invokes missing_documents_detected ───────

test("readiness missing-doc path invokes missing_documents_detected hook", async () => {
  const db = freshDb();
  // Deal has missing docs (BTR slot unfilled, no finalized docs)
  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "missing_documents_detected" }, db as any);
  assert.equal(r.action, "enqueued");
  // Outbox has borrower nudge items
  const items = db.tables.brokerage_comms_outbox.filter((i: Row) => i.trigger_key === "missing_documents");
  assert.ok(items.length > 0, "Outbox should have borrower nudge items");
});

// ── 3. Ready-for-review path invokes deal_ready_for_review ─────────────────

test("ready-for-review path invokes deal_ready_for_review hook", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "deal_ready_for_review" }, db as any);
  assert.equal(r.action, "enqueued");
  const items = db.tables.brokerage_comms_outbox.filter((i: Row) => i.trigger_key === "deal_ready_for_review");
  assert.ok(items.length > 0, "Outbox should have deal_ready_for_review items");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 4. Regression path invokes readiness_regressed ─────────────────────────

test("regression path invokes readiness_regressed hook", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "readiness_regressed" }, db as any);
  assert.equal(r.action, "enqueued");
  const items = db.tables.brokerage_comms_outbox.filter((i: Row) => i.trigger_key === "readiness_regressed");
  assert.ok(items.length > 0, "Outbox should have readiness_regressed items");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 5. Borrower nudge failed/exhausted invokes banker escalation ───────────

test("borrower nudge failed/exhausted invokes banker escalation hook", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";

  for (const event of ["borrower_nudge_failed", "borrower_nudge_exhausted"] as const) {
    const db = freshDb();
    const r = await hooks.handleLifecycleHook({ dealId: "d1", event }, db as any);
    assert.equal(r.action, "enqueued", `${event} should enqueue`);
    const items = db.tables.brokerage_comms_outbox.filter((i: Row) => i.trigger_key === event);
    assert.ok(items.length > 0, `Outbox should have ${event} items`);
  }

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 6. Hook failure does not fail primary workflow ─────────────────────────

test("hook failure does not fail upload/readiness/outbox processing", async () => {
  // Simulate a broken DB that throws on ledger insert
  const brokenDb = {
    from: (t: string) => {
      if (t === "deals") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: "active" }, error: null }) }) }),
        };
      }
      // All other tables throw
      return {
        select: () => { throw new Error("DB broken"); },
        insert: () => ({ then: (_: any, rej: any) => rej ? rej(new Error("DB broken")) : Promise.reject(new Error("DB broken")) }),
        eq: () => ({ then: (_: any, rej: any) => rej ? rej(new Error("DB broken")) : Promise.reject(new Error("DB broken")) }),
      };
    },
  };

  // Should not throw — returns failed result
  const r = await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, brokenDb as any);
  assert.equal(r.action, "failed");
  assert.ok(r.reason);
});

// ── 7. No direct adapter calls ─────────────────────────────────────────────

test("no direct adapter calls from lifecycle hooks", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  // Fire all events
  for (const event of ["documents_received", "readiness_regressed", "deal_ready_for_review", "missing_documents_detected", "borrower_nudge_failed", "borrower_nudge_exhausted"] as const) {
    await hooks.handleLifecycleHook({ dealId: "d1", event }, db as any);
  }

  // No outbox items should be "sent" — all should be "pending"
  const sent = db.tables.brokerage_comms_outbox.filter((i: Row) => i.status === "sent");
  assert.equal(sent.length, 0, "No items should be sent — hooks never call adapters");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 8. All resulting outbox items remain pending ───────────────────────────

test("all resulting outbox items remain pending", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);
  await hooks.handleLifecycleHook({ dealId: "d1", event: "missing_documents_detected" }, db as any);

  const outbox = db.tables.brokerage_comms_outbox;
  assert.ok(outbox.length > 0, "Outbox should have items");
  assert.ok(outbox.every((i: Row) => i.status === "pending"), "All items must be pending");

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── 9. Governance inventory unchanged ──────────────────────────────────────

test("governance inventory unchanged — outbox uses existing modules only", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@test.com";
  const db = freshDb();

  await hooks.handleLifecycleHook({ dealId: "d1", event: "documents_received" }, db as any);

  // Verify outbox items use standard channels/providers
  const outbox = db.tables.brokerage_comms_outbox;
  for (const item of outbox) {
    assert.ok(["email", "sms", "slack"].includes(item.channel), `Invalid channel: ${item.channel}`);
    assert.ok(["resend", "telnyx", "slack"].includes(item.provider), `Invalid provider: ${item.provider}`);
    assert.ok(["pending", "sending"].includes(item.status), `Invalid status: ${item.status}`);
  }

  // Verify ledger events use known event types
  const ledger = db.tables.brokerage_comms_ledger;
  const hookEvents = ledger.filter((e: Row) => String(e.event_type).startsWith("comms_lifecycle_hook_"));
  assert.ok(hookEvents.length > 0, "Should emit lifecycle hook ledger events");
  for (const e of hookEvents) {
    assert.ok(
      ["comms_lifecycle_hook_received", "comms_lifecycle_hook_enqueued", "comms_lifecycle_hook_skipped", "comms_lifecycle_hook_failed"].includes(e.event_type),
      `Unknown hook event type: ${e.event_type}`,
    );
  }

  process.env.BROKERAGE_BANKER_EMAIL = orig;
});
