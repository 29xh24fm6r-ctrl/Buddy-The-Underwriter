import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../borrowerNudges") as typeof import("../borrowerNudges");

type Row = Record<string, any>;

class NS {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = {
      deals: [], borrower_concierge_sessions: [], deal_documents: [],
      deal_document_slots: [], brokerage_comms_outbox: [], brokerage_comms_ledger: [],
      ...init,
    };
  }
  from(t: string) { return new NQ(this, t); }
}

class NQ {
  db: NS; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _u: Row | null; _i: Row[] | null; _l: number | null;
  _ord: { key: string; asc: boolean } | null;

  constructor(db: NS, t: string) {
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

  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  maybeSingle(): Promise<{ data: any; error: any }> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(f: any, r?: any) {
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

function activeDb(extras?: Partial<Record<string, Row[]>>) {
  return new NS({
    deals: [{ id: "d1", status: "active", borrower_name: "Jane Smith", borrower_email: "jane@test.com" }],
    borrower_concierge_sessions: [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "Jane", phone: "+12025551234", sms_opt_in: true } } }],
    deal_documents: [{ deal_id: "d1", canonical_type: "INCOME_STATEMENT", finalized_at: "2026-01-01" }],
    deal_document_slots: [
      { deal_id: "d1", required_doc_type: "BUSINESS_TAX_RETURN" },
      { deal_id: "d1", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT" },
      { deal_id: "d1", required_doc_type: "INCOME_STATEMENT" },
    ],
    ...extras,
  });
}

// ── Eligibility ─────────────────────────────────────────────────────────────

test("no missing docs → skipped", async () => {
  const db = new NS({
    deals: [{ id: "d1", status: "active", borrower_email: "x@y.com" }],
    deal_documents: [{ deal_id: "d1", canonical_type: "BTR", finalized_at: "2026-01-01" }],
    deal_document_slots: [{ deal_id: "d1", required_doc_type: "BTR" }],
    borrower_concierge_sessions: [],
  });
  const elig = await m.getBorrowerNudgeEligibility("d1", db as any);
  assert.equal(elig.eligible, false);
  assert.equal(elig.skipReason, "no_missing_docs");
});

test("closed/funded/archived → skipped", async () => {
  for (const status of ["closed", "funded", "archived", "docs_complete"]) {
    const db = new NS({ deals: [{ id: "d1", status }] });
    const elig = await m.getBorrowerNudgeEligibility("d1", db as any);
    assert.equal(elig.eligible, false);
    assert.ok(elig.skipReason?.includes(status));
  }
});

test("email eligible with borrower email", async () => {
  const db = activeDb();
  const elig = await m.getBorrowerNudgeEligibility("d1", db as any);
  assert.equal(elig.eligible, true);
  assert.equal(elig.emailAllowed, true);
  assert.equal(elig.borrowerEmail, "jane@test.com");
});

test("SMS eligible only with opt-in + E.164", async () => {
  const db = activeDb();
  const elig = await m.getBorrowerNudgeEligibility("d1", db as any);
  assert.equal(elig.smsAllowed, true);
  assert.equal(elig.borrowerPhone, "+12025551234");
});

test("SMS skipped without opt-in", async () => {
  const db = new NS({
    deals: [{ id: "d1", status: "active", borrower_email: "x@y.com" }],
    borrower_concierge_sessions: [{ deal_id: "d1", extracted_facts: { borrower: { phone: "+12025551234", sms_opt_in: false } } }],
    deal_document_slots: [{ deal_id: "d1", required_doc_type: "BTR" }],
    deal_documents: [],
  });
  const elig = await m.getBorrowerNudgeEligibility("d1", db as any);
  assert.equal(elig.smsAllowed, false);
});

// ── Nudge plan ──────────────────────────────────────────────────────────────

test("missing docs included in email body", async () => {
  const db = activeDb();
  const plan = await m.buildBorrowerNudgePlan("d1", db as any);
  assert.equal(plan.skipped, false);
  assert.ok(plan.emailBody?.includes("BUSINESS TAX RETURN"));
  assert.ok(plan.emailBody?.includes("PERSONAL FINANCIAL STATEMENT"));
});

test("secure upload link placeholder included", async () => {
  const db = activeDb();
  const plan = await m.buildBorrowerNudgePlan("d1", db as any);
  assert.ok(plan.emailBody?.includes("{{UPLOAD_LINK}}"));
});

// ── Enqueue ─────────────────────────────────────────────────────────────────

test("enqueue uses comms outbox", async () => {
  const db = activeDb();
  const result = await m.enqueueBorrowerNudges("d1", db as any);
  assert.ok(result.enqueued >= 1);
  assert.ok(result.outboxIds.length >= 1);
  assert.ok(db.tables.brokerage_comms_outbox.length >= 1);
  // Verify outbox has correct shape
  const item = db.tables.brokerage_comms_outbox[0];
  assert.equal(item.status, "pending");
  assert.ok(item.idempotency_key.startsWith("borrower_nudge:d1:"));
});

test("daily idempotency prevents duplicate nudges", async () => {
  const db = activeDb();
  const r1 = await m.enqueueBorrowerNudges("d1", db as any);
  const r2 = await m.enqueueBorrowerNudges("d1", db as any);
  assert.ok(r1.enqueued >= 1);
  assert.equal(r2.enqueued, 0);
  assert.ok(r2.skipped >= 1);
});

test("existing pending outbox prevents duplicate", async () => {
  const db = activeDb();
  const r1 = await m.enqueueBorrowerNudges("d1", db as any);
  // Outbox items already exist in pending state
  const r2 = await m.enqueueBorrowerNudges("d1", db as any);
  assert.equal(r2.enqueued, 0);
  // Total outbox items should not increase
  const emailItems = db.tables.brokerage_comms_outbox.filter(i => i.channel === "email");
  assert.equal(emailItems.length, 1);
});

// ── Ledger ──────────────────────────────────────────────────────────────────

test("ledger emits plan/enqueued events", async () => {
  const db = activeDb();
  await m.enqueueBorrowerNudges("d1", db as any);
  const events = db.tables.brokerage_comms_ledger.map(e => e.event_type);
  assert.ok(events.includes("borrower_nudge_plan_built"));
  assert.ok(events.includes("borrower_nudge_enqueued"));
});

test("ledger emits skipped event for ineligible", async () => {
  const db = new NS({
    deals: [{ id: "d1", status: "funded" }],
  });
  await m.enqueueBorrowerNudges("d1", db as any);
  const events = db.tables.brokerage_comms_ledger.map(e => e.event_type);
  assert.ok(events.includes("borrower_nudge_plan_built"));
  assert.ok(events.includes("borrower_nudge_skipped"));
});
