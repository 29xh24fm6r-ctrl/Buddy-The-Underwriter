import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  runLiveFunnelCheck,
  validateFunnelPayloadSafety,
  validateConversionEventTypes,
} = require("../liveFunnelCheck") as typeof import("../liveFunnelCheck");

type Row = Record<string, any>;

// ── Stub ────────────────────────────────────────────────────────────────────

class FS {
  tables: Record<string, Row[]>;
  constructor(i?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_leads: [], brokerage_conversion_events: [], deals: [], borrower_session_tokens: [], ...i };
  }
  from(t: string) { return new FQ(this, t); }
}

class FQ {
  db: FS; table: string; filters: Array<{ t: string; k: string; v: any }>; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: FS, t: string) { this.db = db; this.table = t; this.filters = []; this._l = null; this._ord = null; }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  maybeSingle(): Promise<{ data: any; error: any }> { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  then(f: any, r?: any) { return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) { if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v); }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("dry run passes with all steps ok", async () => {
  const db = new FS();
  const r = await runLiveFunnelCheck({ sb: db as any, dryRun: true });
  assert.equal(r.ok, true);
  assert.ok(r.steps.length >= 6);
  assert.ok(r.steps.every(s => s.ok));
});

test("full funnel passes with complete data", async () => {
  const db = new FS({
    brokerage_leads: [{ id: "lead-1", email: "funnel-test@buddysba.com", status: "converted", source: "apply_page", converted_deal_id: "deal-1", created_at: new Date().toISOString() }],
    deals: [{ id: "deal-1", borrower_email: "funnel-test@buddysba.com", display_name: "Test Deal", status: "active", origin: "brokerage_anonymous" }],
    borrower_session_tokens: [{ deal_id: "deal-1", expires_at: new Date(Date.now() + 86400000).toISOString() }],
    brokerage_conversion_events: [
      { lead_id: "lead-1", event_type: "lead_captured" },
      { lead_id: "lead-1", event_type: "session_started" },
      { lead_id: "lead-1", event_type: "deal_created" },
    ],
  });
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "funnel-test@buddysba.com" });
  assert.equal(r.ok, true);
  assert.ok(r.steps.every(s => s.ok), `Failed steps: ${r.steps.filter(s => !s.ok).map(s => s.name).join(", ")}`);
});

test("missing lead fails", async () => {
  const db = new FS();
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "nobody@test.com" });
  assert.equal(r.ok, false);
  assert.ok(r.steps.find(s => s.name === "lead_captured")?.ok === false);
});

test("missing deal fails", async () => {
  const db = new FS({
    brokerage_leads: [{ id: "lead-1", email: "test@t.com", status: "new", created_at: new Date().toISOString() }],
  });
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "test@t.com" });
  assert.ok(r.steps.find(s => s.name === "deal_created")?.ok === false);
});

test("missing session token fails", async () => {
  const db = new FS({
    brokerage_leads: [{ id: "lead-1", email: "test@t.com", status: "converted", converted_deal_id: "deal-1", created_at: new Date().toISOString() }],
    deals: [{ id: "deal-1", borrower_email: "test@t.com", status: "active" }],
  });
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "test@t.com" });
  assert.ok(r.steps.find(s => s.name === "session_token")?.ok === false);
});

test("missing conversion events fails", async () => {
  const db = new FS({
    brokerage_leads: [{ id: "lead-1", email: "test@t.com", status: "converted", converted_deal_id: "deal-1", created_at: new Date().toISOString() }],
    deals: [{ id: "deal-1", borrower_email: "test@t.com", status: "active" }],
    borrower_session_tokens: [{ deal_id: "deal-1", expires_at: new Date(Date.now() + 86400000).toISOString() }],
    brokerage_conversion_events: [{ lead_id: "lead-1", event_type: "lead_captured" }],
  });
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "test@t.com" });
  assert.ok(r.steps.find(s => s.name === "conversion_events")?.ok === false);
});

test("payload with token_hash fails safety", () => {
  assert.equal(validateFunnelPayloadSafety({ ok: true, dealId: "d1" }).ok, true);
  assert.equal(validateFunnelPayloadSafety({ ok: true, token_hash: "abc" }).ok, false);
  assert.equal(validateFunnelPayloadSafety({ ok: true, rawToken: "abc" }).ok, false);
  assert.equal(validateFunnelPayloadSafety({ ok: true, password: "abc" }).ok, false);
});

test("conversion event types validation", () => {
  assert.equal(validateConversionEventTypes(["lead_captured", "session_started", "deal_created"]).ok, true);
  assert.equal(validateConversionEventTypes(["lead_captured"]).ok, false);
  assert.deepEqual(validateConversionEventTypes(["lead_captured"]).missing, ["session_started", "deal_created"]);
});

test("ops visibility passes when deal exists", async () => {
  const db = new FS({
    brokerage_leads: [{ id: "lead-1", email: "ops@t.com", status: "converted", converted_deal_id: "deal-1", created_at: new Date().toISOString() }],
    deals: [{ id: "deal-1", borrower_email: "ops@t.com", display_name: "Ops Test", status: "active", origin: "brokerage_anonymous" }],
    borrower_session_tokens: [{ deal_id: "deal-1", expires_at: new Date(Date.now() + 86400000).toISOString() }],
    brokerage_conversion_events: [
      { lead_id: "lead-1", event_type: "lead_captured" },
      { lead_id: "lead-1", event_type: "session_started" },
      { lead_id: "lead-1", event_type: "deal_created" },
    ],
  });
  const r = await runLiveFunnelCheck({ sb: db as any, testEmail: "ops@t.com" });
  assert.ok(r.steps.find(s => s.name === "ops_visibility")?.ok === true);
});
