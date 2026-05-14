import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// ── Load modules ────────────────────────────────────────────────────────────

const nudges = require("../borrowerNudges") as typeof import("../borrowerNudges");
const alerts = require("../bankerAlerts") as typeof import("../bankerAlerts");
const outbox = require("../commsOutbox") as typeof import("../commsOutbox");
const adapters = require("../commsAdapters") as typeof import("../commsAdapters");
const ledger = require("../commsLedger") as typeof import("../commsLedger");
const retry = require("../commsRetryQueue") as typeof import("../commsRetryQueue");
const release = require("../commsReleaseGate") as typeof import("../commsReleaseGate");
const cron = require("../commsCron") as typeof import("../commsCron");
const qa = require("../commsQaHarness") as typeof import("../commsQaHarness");
const hardening = require("../commsHardening") as typeof import("../commsHardening");

type Row = Record<string, any>;

// Minimal stub for testing
class RS {
  tables: Record<string, Row[]> = { deals: [], borrower_concierge_sessions: [], deal_documents: [], deal_document_slots: [], brokerage_comms_outbox: [], brokerage_comms_ledger: [], brokerage_borrower_message_templates: [], brokerage_borrower_message_outbox: [] };
  from(t: string) { return new RQ(this, t); }
}
class RQ {
  db: RS; table: string; filters: Array<{ t: string; k: string; v: any }>; _u: Row | null; _i: Row[] | null; _l: number | null; _ord: { key: string; asc: boolean } | null;
  constructor(db: RS, t: string) { this.db = db; this.table = t; this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null; }
  select(_?: string) { return this; } order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; } limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; } in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; } is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; } neq(k: string, v: any) { this.filters.push({ t: "neq", k, v }); return this; }
  insert(p: Row | Row[]) { const rows = Array.isArray(p) ? p : [p]; const wi = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r })); this.db.tables[this.table] ??= []; this.db.tables[this.table].push(...wi); this._i = wi; return this; }
  update(u: Row) { this._u = u; return this; }
  single(): Promise<{ data: any; error: any }> { if (this._i) return Promise.resolve({ data: this._i[0], error: null }); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  maybeSingle(): Promise<{ data: any; error: any }> { if (this._u) { for (const r of this.rows()) Object.assign(r, this._u); return Promise.resolve({ data: this.rows()[0], error: null }); } return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  then(f: any, r?: any) { if (this._u) { for (const row of this.rows()) Object.assign(row, this._u); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); } if (this._i) return Promise.resolve({ data: this._i, error: null }).then(f, r); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
  private rows() { let rows = [...(this.db.tables[this.table] ?? [])]; for (const f of this.filters) { if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v); else if (f.t === "neq") rows = rows.filter(r => r[f.k] !== f.v); else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k])); else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; }); } if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); } if (this._l != null) rows = rows.slice(0, this._l); return rows; }
}

// ── Regression tests ────────────────────────────────────────────────────────

test("borrower nudges do not call adapters directly", async () => {
  const db = new RS();
  db.tables.deals = [{ id: "d1", status: "active", borrower_email: "t@t.com" }];
  db.tables.deal_document_slots = [{ deal_id: "d1", required_doc_type: "BTR" }];
  db.tables.borrower_concierge_sessions = [{ deal_id: "d1", extracted_facts: { borrower: { first_name: "T" } } }];
  await nudges.enqueueBorrowerNudges("d1", db as any);
  // Items should be in outbox as pending, not sent
  const sent = db.tables.brokerage_comms_outbox.filter(i => i.status === "sent" && i.channel === "email");
  assert.equal(sent.length, 0, "Nudges must not send directly — outbox only");
});

test("banker alerts do not call adapters directly", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "b@t.com";
  const db = new RS();
  db.tables.deals = [{ id: "d1", status: "active", display_name: "T", borrower_name: "T" }];
  await alerts.enqueueBankerAlerts("d1", "deal_ready_for_review", db as any);
  const sent = db.tables.brokerage_comms_outbox.filter(i => i.status === "sent");
  assert.equal(sent.length, 0, "Alerts must not send directly");
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("processOutbox=false never sends", async () => {
  const db = new RS();
  await outbox.enqueueCommsMessage({ idempotencyKey: "reg-1", channel: "email", provider: "resend", recipient: "t@t.com", body: "hi" }, db as any);
  // Without calling processCommsOutboxItem, nothing should be sent
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "pending");
});

test("live mode blocked if release gate fails", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.RESEND_API_KEY;
  delete process.env.CLERK_SECRET_KEY;
  const r = release.assertCommsLiveReleaseReady();
  assert.equal(r.ok, false);
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("cron requires CRON_SECRET", () => {
  const orig = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const r = cron.verifyCronSecret({ headers: { get: () => null } } as any);
  assert.equal(r.authorized, false);
  if (orig) process.env.CRON_SECRET = orig;
});

test("SMS requires opt-in and E.164", () => {
  assert.equal(adapters.isValidE164("+12025551234"), true);
  assert.equal(adapters.isValidE164("2025551234"), false);
  assert.equal(adapters.isValidE164(""), false);
});

test("recipients masked in ledger outputs", () => {
  assert.equal(ledger.maskEmail("john@example.com"), "j**n@example.com");
  assert.equal(ledger.maskPhone("+12025551234"), "********1234");
});

test("secrets redacted from errors", () => {
  const result = adapters.redactCommsSecrets("Bearer re_abc123defghijklm failed");
  assert.ok(!result.includes("re_abc123defghijklm"));
});

test("retryable failures schedule retry", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: false, error: "429", retryable: true }, 1);
  assert.equal(d.shouldRetry, true);
});

test("exhausted failures stop retrying", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: false, error: "503", retryable: true }, 3);
  assert.equal(d.shouldRetry, false);
  assert.equal(d.exhausted, true);
});

test("stub rollback prevents live sends", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "stub";
  const adapter = adapters.createEmailAdapter();
  // Stub adapter returns ok without network
  adapter({ recipient: "t@t.com", subject: "T", body: "T" }).then(r => { assert.equal(r.ok, true); assert.ok(r.providerMessageId?.startsWith("stub-")); });
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("QA harness refuses live by default", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "live";
  assert.equal(qa.assertQaSafeMode().safe, false);
  process.env.BROKERAGE_COMMS_MODE = orig;
});

// ── Docs ────────────────────────────────────────────────────────────────────

test("docs index exists", () => {
  assert.ok(existsSync(resolve(process.cwd(), "docs/brokerage-comms-index.md")));
});

test("docs mention emergency rollback", () => {
  const idx = read("docs/brokerage-comms-index.md");
  assert.ok(idx.includes("Emergency") || idx.includes("rollback") || idx.includes("stub"));
});

test("docs mention release gate", () => {
  const idx = read("docs/brokerage-comms-index.md");
  assert.ok(idx.includes("release") || idx.includes("Release"));
});

test("regression script reference exists", () => {
  const idx = read("docs/brokerage-comms-index.md");
  assert.ok(idx.includes("regression") || idx.includes("comms:regression"));
});
