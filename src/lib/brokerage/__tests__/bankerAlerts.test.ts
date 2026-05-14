import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../bankerAlerts") as typeof import("../bankerAlerts");

type Row = Record<string, any>;

class BS {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = { deals: [], brokerage_comms_outbox: [], brokerage_comms_ledger: [], ...init };
  }
  from(t: string) { return new BQ(this, t); }
}

class BQ {
  db: BS; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _i: Row[] | null; _l: number | null;

  constructor(db: BS, t: string) { this.db = db; this.table = t; this.filters = []; this._i = null; this._l = null; }
  select(_?: string) { return this; }
  order(_k: string, _o?: any) { return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }

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
    }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

function activeDeal() {
  return new BS({
    deals: [{ id: "d1", status: "active", display_name: "Test Deal", borrower_name: "Jane Smith", bank_id: "brk-1" }],
  });
}

// ── Eligibility ─────────────────────────────────────────────────────────────

test("closed/funded/archived → skipped", async () => {
  for (const status of ["closed", "funded", "archived"]) {
    const db = new BS({ deals: [{ id: "d1", status }] });
    const elig = await m.getBankerAlertEligibility("d1", db as any);
    assert.equal(elig.eligible, false);
    assert.ok(elig.skipReason?.includes(status));
  }
});

test("email eligible when banker email exists", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  const elig = await m.getBankerAlertEligibility("d1", db as any);
  assert.equal(elig.eligible, true);
  assert.equal(elig.emailAllowed, true);
  assert.equal(elig.bankerEmail, "banker@buddy.com");
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("email skipped when banker email missing", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  const origSlack = process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  delete process.env.BROKERAGE_BANKER_EMAIL;
  delete process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  const db = activeDeal();
  const elig = await m.getBankerAlertEligibility("d1", db as any);
  assert.equal(elig.emailAllowed, false);
  assert.equal(elig.eligible, false);
  assert.equal(elig.skipReason, "no_banker_contact");
  if (orig) process.env.BROKERAGE_BANKER_EMAIL = orig;
  if (origSlack) process.env.BROKERAGE_SLACK_WEBHOOK_URL = origSlack;
});

test("Slack eligible only when webhook configured", async () => {
  const origEmail = process.env.BROKERAGE_BANKER_EMAIL;
  const origSlack = process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  delete process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
  const db = activeDeal();
  const elig = await m.getBankerAlertEligibility("d1", db as any);
  assert.equal(elig.slackAllowed, true);
  assert.equal(elig.eligible, true);
  if (origEmail) process.env.BROKERAGE_BANKER_EMAIL = origEmail;
  process.env.BROKERAGE_SLACK_WEBHOOK_URL = origSlack;
});

// ── Alert content ───────────────────────────────────────────────────────────

test("each purpose builds content", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  const purposes: Array<import("../bankerAlerts").BankerAlertPurpose> = [
    "borrower_nudge_enqueued", "borrower_nudge_failed", "borrower_nudge_exhausted",
    "documents_received", "readiness_regressed", "deal_ready_for_review",
  ];
  for (const p of purposes) {
    const plan = await m.buildBankerAlertPlan("d1", p, db as any);
    assert.equal(plan.skipped, false, `Purpose ${p} should not be skipped`);
    assert.ok(plan.emailSubject, `Purpose ${p} missing subject`);
    assert.ok(plan.emailBody, `Purpose ${p} missing body`);
  }
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("email includes deal link placeholder", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  const plan = await m.buildBankerAlertPlan("d1", "deal_ready_for_review", db as any);
  assert.ok(plan.emailBody?.includes("{{DEAL_LINK}}"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("Slack body concise", async () => {
  const origSlack = process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  process.env.BROKERAGE_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
  const db = activeDeal();
  const plan = await m.buildBankerAlertPlan("d1", "documents_received", db as any);
  assert.ok(plan.slackBody);
  assert.ok(plan.slackBody!.length < 300, "Slack body should be concise");
  assert.ok(plan.slackBody!.includes("{{DEAL_LINK}}"));
  process.env.BROKERAGE_SLACK_WEBHOOK_URL = origSlack;
});

// ── Enqueue ─────────────────────────────────────────────────────────────────

test("enqueue uses commsOutbox", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  const r = await m.enqueueBankerAlerts("d1", "deal_ready_for_review", db as any);
  assert.ok(r.enqueued >= 1);
  assert.ok(db.tables.brokerage_comms_outbox.length >= 1);
  assert.equal(db.tables.brokerage_comms_outbox[0].status, "pending");
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("daily idempotency prevents duplicate alert", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  const r1 = await m.enqueueBankerAlerts("d1", "documents_received", db as any);
  const r2 = await m.enqueueBankerAlerts("d1", "documents_received", db as any);
  assert.ok(r1.enqueued >= 1);
  assert.equal(r2.enqueued, 0);
  assert.ok(r2.skipped >= 1);
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("pending outbox prevents duplicate alert", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  await m.enqueueBankerAlerts("d1", "readiness_regressed", db as any);
  await m.enqueueBankerAlerts("d1", "readiness_regressed", db as any);
  const emailItems = db.tables.brokerage_comms_outbox.filter(i => i.channel === "email");
  assert.equal(emailItems.length, 1);
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

// ── Ledger ──────────────────────────────────────────────────────────────────

test("ledger emits plan/enqueued events", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  process.env.BROKERAGE_BANKER_EMAIL = "banker@buddy.com";
  const db = activeDeal();
  await m.enqueueBankerAlerts("d1", "deal_ready_for_review", db as any);
  const types = db.tables.brokerage_comms_ledger.map(e => e.event_type);
  assert.ok(types.includes("banker_alert_plan_built"));
  assert.ok(types.includes("banker_alert_enqueued"));
  process.env.BROKERAGE_BANKER_EMAIL = orig;
});

test("ledger emits skipped event", async () => {
  const orig = process.env.BROKERAGE_BANKER_EMAIL;
  const origSlack = process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  delete process.env.BROKERAGE_BANKER_EMAIL;
  delete process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  const db = activeDeal();
  await m.enqueueBankerAlerts("d1", "documents_received", db as any);
  const types = db.tables.brokerage_comms_ledger.map(e => e.event_type);
  assert.ok(types.includes("banker_alert_skipped"));
  if (orig) process.env.BROKERAGE_BANKER_EMAIL = orig;
  if (origSlack) process.env.BROKERAGE_SLACK_WEBHOOK_URL = origSlack;
});
