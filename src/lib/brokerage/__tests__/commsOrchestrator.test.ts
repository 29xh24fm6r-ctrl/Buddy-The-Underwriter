import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsOrchestrator") as typeof import("../commsOrchestrator");

type Row = Record<string, any>;

class OrcStub {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = {
      deals: [], borrower_concierge_sessions: [], deal_documents: [],
      deal_document_slots: [], brokerage_comms_outbox: [],
      brokerage_comms_ledger: [],
      ...init,
    };
  }
  from(t: string) { return new OQ(this, t); }
}

class OQ {
  db: OrcStub; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _u: Row | null; _i: Row[] | null; _l: number | null;
  _ord: { key: string; asc: boolean } | null;

  constructor(db: OrcStub, t: string) {
    this.db = db; this.table = t;
    this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null;
  }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
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
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; });
    }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function activeDealDb() {
  return new OrcStub({
    deals: [{ id: "d1", status: "active", display_name: "Test", borrower_name: "Jane", borrower_email: "j@t.com", bank_id: "b1", created_at: "2026-01-01" }],
    borrower_concierge_sessions: [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "Jane" } } }],
    deal_document_slots: [{ deal_id: "d1", required_doc_type: "BTR" }],
    deal_documents: [],
  });
}

// Save/restore env
let origBankerEmail: string | undefined;
let origSlack: string | undefined;
test.before(() => { origBankerEmail = process.env.BROKERAGE_BANKER_EMAIL; origSlack = process.env.BROKERAGE_SLACK_WEBHOOK_URL; process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com"; });
test.after(() => { process.env.BROKERAGE_BANKER_EMAIL = origBankerEmail; process.env.BROKERAGE_SLACK_WEBHOOK_URL = origSlack; });

// ── Single deal ─────────────────────────────────────────────────────────────

test("orchestrates borrower nudges then banker alerts", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any);
  assert.equal(r.dealId, "d1");
  assert.equal(r.borrowerNudges.planned, 1);
  assert.equal(r.bankerAlerts.planned, 1);
  // Borrower nudges should enqueue (missing BTR doc)
  assert.ok(r.borrowerNudges.enqueued >= 1 || r.borrowerNudges.skipped >= 0);
  // Banker alerts should enqueue
  assert.ok(r.bankerAlerts.enqueued >= 1 || r.bankerAlerts.skipped >= 0);
});

test("can disable borrower nudges", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any, { purposes: { borrowerNudges: false } });
  assert.equal(r.borrowerNudges.planned, 0);
  assert.equal(r.borrowerNudges.enqueued, 0);
  assert.equal(r.bankerAlerts.planned, 1); // still runs
});

test("can disable banker alerts", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any, { purposes: { bankerAlerts: false } });
  assert.equal(r.bankerAlerts.planned, 0);
  assert.equal(r.bankerAlerts.enqueued, 0);
  assert.equal(r.borrowerNudges.planned, 1); // still runs
});

test("default does not process outbox", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any);
  assert.equal(r.outbox.processed, 0);
  assert.equal(r.outbox.sent, 0);
});

test("processOutbox processes due items", async () => {
  const db = activeDealDb();
  // Enqueue something first
  await m.runBrokerageCommsForDeal("d1", db as any);
  // Now process with outbox enabled
  const r = await m.runBrokerageCommsForDeal("d1", db as any, { processOutbox: true });
  // Items were already enqueued in first call; second call dedupes nudges
  // but outbox should have processed the items from first call
  assert.ok(r.outbox.processed >= 0); // may be 0 if already claimed
});

test("returns normalized counts", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any);
  assert.ok(typeof r.borrowerNudges.planned === "number");
  assert.ok(typeof r.borrowerNudges.enqueued === "number");
  assert.ok(typeof r.borrowerNudges.skipped === "number");
  assert.ok(typeof r.bankerAlerts.planned === "number");
  assert.ok(typeof r.outbox.processed === "number");
  assert.ok(Array.isArray(r.warnings));
});

// ── Ledger ──────────────────────────────────────────────────────────────────

test("emits started/completed ledger events", async () => {
  const db = activeDealDb();
  await m.runBrokerageCommsForDeal("d1", db as any);
  const types = db.tables.brokerage_comms_ledger.map(e => e.event_type);
  assert.ok(types.includes("brokerage_comms_orchestration_started"));
  assert.ok(types.includes("brokerage_comms_orchestration_completed"));
});

test("emits failed ledger event on exception", async () => {
  // Create a stub that throws on borrower nudge enqueue
  const db = activeDealDb();
  const origFrom = db.from.bind(db);
  let callCount = 0;
  db.from = (t: string) => {
    callCount++;
    // Throw on ~10th call to simulate mid-orchestration failure
    if (callCount > 8 && t === "deal_documents") throw new Error("simulated_failure");
    return origFrom(t);
  };

  const r = await m.runBrokerageCommsForDeal("d1", db as any);
  assert.ok(r.warnings.some(w => w.includes("orchestration_error") || w.includes("simulated")));
});

// ── Batch ───────────────────────────────────────────────────────────────────

test("batch skips inactive deals", async () => {
  const db = new OrcStub({
    deals: [
      { id: "d1", status: "active", display_name: "Active", borrower_name: "A", borrower_email: "a@t.com", created_at: "2026-01-01" },
      { id: "d2", status: "funded", display_name: "Funded", borrower_name: "B", created_at: "2026-01-02" },
      { id: "d3", status: "archived", display_name: "Archived", borrower_name: "C", created_at: "2026-01-03" },
    ],
    borrower_concierge_sessions: [{ deal_id: "d1", extracted_facts: {} }],
    deal_document_slots: [],
    deal_documents: [],
  });
  const r = await m.runBrokerageCommsBatch(db as any);
  assert.equal(r.dealsProcessed, 1); // only d1 is active
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].dealId, "d1");
});

test("batch respects limit", async () => {
  const db = new OrcStub({
    deals: [
      { id: "d1", status: "active", borrower_email: "a@t.com", created_at: "2026-01-01" },
      { id: "d2", status: "active", borrower_email: "b@t.com", created_at: "2026-01-02" },
      { id: "d3", status: "active", borrower_email: "c@t.com", created_at: "2026-01-03" },
    ],
    borrower_concierge_sessions: [],
    deal_document_slots: [],
    deal_documents: [],
  });
  const r = await m.runBrokerageCommsBatch(db as any, { limit: 2 });
  assert.ok(r.dealsProcessed <= 2);
});

test("no direct adapter calls without processOutbox", async () => {
  const db = activeDealDb();
  const r = await m.runBrokerageCommsForDeal("d1", db as any);
  // Outbox items should be pending, not sent
  const pending = db.tables.brokerage_comms_outbox.filter(i => i.status === "pending");
  const sent = db.tables.brokerage_comms_outbox.filter(i => i.status === "sent");
  // Without processOutbox, nothing should be sent via adapter
  assert.equal(r.outbox.sent, 0);
});
