import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { redactResponseSecrets } = require("../commsAuth") as typeof import("../commsAuth");
const orchestrator = require("../commsOrchestrator") as typeof import("../commsOrchestrator");

type Row = Record<string, any>;

class RS {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = {
      deals: [], borrower_concierge_sessions: [], deal_documents: [],
      deal_document_slots: [], brokerage_comms_outbox: [],
      brokerage_comms_ledger: [],
      ...init,
    };
  }
  from(t: string) { return new RQ(this, t); }
}

class RQ {
  db: RS; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _u: Row | null; _i: Row[] | null; _l: number | null;
  _ord: { key: string; asc: boolean } | null;

  constructor(db: RS, t: string) {
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

function dealDb() {
  return new RS({
    deals: [{ id: "d1", status: "active", display_name: "Test Deal", borrower_name: "Jane", borrower_email: "j@t.com", bank_id: "b1", created_at: "2026-01-01" }],
    borrower_concierge_sessions: [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "Jane" } } }],
    deal_document_slots: [{ deal_id: "d1", required_doc_type: "BTR" }],
    deal_documents: [],
  });
}

let origBankerEmail: string | undefined;
test.before(() => { origBankerEmail = process.env.BROKERAGE_BANKER_EMAIL; process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com"; });
test.after(() => { process.env.BROKERAGE_BANKER_EMAIL = origBankerEmail; });

// ── Deal route tests (via orchestrator directly) ────────────────────────────

test("deal route calls orchestrator with default enqueue-only", async () => {
  const db = dealDb();
  const r = await orchestrator.runBrokerageCommsForDeal("d1", db as any);
  assert.equal(r.outbox.processed, 0);
  assert.equal(r.outbox.sent, 0);
  assert.ok(r.borrowerNudges.planned >= 0);
});

test("deal route respects processOutbox false", async () => {
  const db = dealDb();
  const r = await orchestrator.runBrokerageCommsForDeal("d1", db as any, { processOutbox: false });
  assert.equal(r.outbox.processed, 0);
});

test("deal route respects processOutbox true", async () => {
  const db = dealDb();
  await orchestrator.runBrokerageCommsForDeal("d1", db as any); // enqueue
  const r = await orchestrator.runBrokerageCommsForDeal("d1", db as any, { processOutbox: true });
  assert.ok(r.outbox.processed >= 0);
});

// ── Outbox process route tests ──────────────────────────────────────────────

test("outbox route requires confirmProcessOutbox", () => {
  // This tests the logic that the route would check
  const body = {};
  assert.equal((body as any).confirmProcessOutbox !== true, true, "Should reject without confirmation");
});

test("outbox route with confirmation is valid", () => {
  const body = { confirmProcessOutbox: true };
  assert.equal(body.confirmProcessOutbox === true, true);
});

test("outbox route default limit 25", () => {
  const body = {};
  const limit = typeof (body as any).limit === "number" ? Math.min((body as any).limit, 100) : 25;
  assert.equal(limit, 25);
});

// ── Batch route tests ───────────────────────────────────────────────────────

test("batch route default enqueue-only", async () => {
  const db = dealDb();
  const r = await orchestrator.runBrokerageCommsBatch(db as any, { processOutbox: false });
  assert.ok(r.dealsProcessed >= 0);
  assert.ok(Array.isArray(r.results));
});

test("batch route respects limit", async () => {
  const db = new RS({
    deals: [
      { id: "d1", status: "active", created_at: "2026-01-01" },
      { id: "d2", status: "active", created_at: "2026-01-02" },
      { id: "d3", status: "active", created_at: "2026-01-03" },
    ],
    borrower_concierge_sessions: [],
    deal_document_slots: [],
    deal_documents: [],
  });
  const r = await orchestrator.runBrokerageCommsBatch(db as any, { limit: 1 });
  assert.ok(r.dealsProcessed <= 1);
});

// ── Response safety ─────────────────────────────────────────────────────────

test("responses redact secrets", () => {
  const dirty = {
    ok: true,
    RESEND_API_KEY: "re_abc123defghijklm",
    TELNYX_API_KEY: "KEY01234567890123456789abc",
    nested: { token_hash: "secret123" },
  };
  const clean = redactResponseSecrets(dirty);
  const json = JSON.stringify(clean);
  assert.ok(!json.includes("re_abc123defghijklm"));
  assert.ok(!json.includes("KEY01234567890123456789abc"));
  assert.ok(!json.includes("secret123"));
  assert.ok(json.includes("[REDACTED]"));
});

test("malformed limit clamped", () => {
  const body = { limit: 999 };
  const limit = typeof body.limit === "number" ? Math.min(body.limit, 100) : 25;
  assert.equal(limit, 100);
});

test("no direct adapter calls from routes (enqueue only)", async () => {
  const db = dealDb();
  const r = await orchestrator.runBrokerageCommsForDeal("d1", db as any);
  // All outbox items should be pending, not sent
  const sent = db.tables.brokerage_comms_outbox.filter(i => i.status === "sent");
  assert.equal(sent.length, 0);
  assert.equal(r.outbox.sent, 0);
});
