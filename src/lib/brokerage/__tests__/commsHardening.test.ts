import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const h = require("../commsHardening") as typeof import("../commsHardening");
// commsAuth has server-only transitively — use inline redact for test
function redactResponseSecrets(obj: Record<string, any>): Record<string, any> {
  const json = JSON.stringify(obj);
  return JSON.parse(json.replace(/re_[A-Za-z0-9_-]{10,}/g, "[REDACTED]").replace(/KEY[A-Za-z0-9_-]{20,}/g, "[REDACTED]"));
}
const { verifyCronSecret } = require("../commsCron") as typeof import("../commsCron");

type Row = Record<string, any>;

class HS {
  tables: Record<string, Row[]>;
  constructor(init?: Partial<Record<string, Row[]>>) {
    this.tables = { brokerage_comms_outbox: [], brokerage_comms_ledger: [], ...init };
  }
  from(t: string) { return new HQ(this, t); }
}
class HQ {
  db: HS; table: string; filters: Array<{ t: string; k: string; v: any }>; _l: number | null;
  constructor(db: HS, t: string) { this.db = db; this.table = t; this.filters = []; this._l = null; }
  select(_?: string) { return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  limit(n: number) { this._l = n; return this; }
  then(f: any, r?: any) {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const fl of this.filters) { if (fl.t === "eq") rows = rows.filter(r => r[fl.k] === fl.v); }
    if (this._l != null) rows = rows.slice(0, this._l);
    return Promise.resolve({ data: rows, error: null }).then(f, r);
  }
}

// ── Rate limits ─────────────────────────────────────────────────────────────

test("per-deal daily nudge cap enforced", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const db = new HS({
    brokerage_comms_outbox: [
      { id: "1", deal_id: "d1", trigger_key: "missing_documents", created_at: `${today}T10:00:00Z` },
      { id: "2", deal_id: "d1", trigger_key: "missing_documents", created_at: `${today}T11:00:00Z` },
    ],
  });
  const r = await h.checkDealNudgeRateLimit("d1", db as any);
  assert.equal(r.allowed, false);
  assert.ok(r.reason?.includes("cap"));
  assert.equal(r.current, 2);
  assert.equal(r.max, 2);
});

test("under cap allows nudge", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const db = new HS({
    brokerage_comms_outbox: [
      { id: "1", deal_id: "d1", trigger_key: "missing_documents", created_at: `${today}T10:00:00Z` },
    ],
  });
  const r = await h.checkDealNudgeRateLimit("d1", db as any);
  assert.equal(r.allowed, true);
});

test("SMS daily borrower cap enforced", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const db = new HS({
    brokerage_comms_outbox: [
      { id: "1", channel: "sms", recipient: "+12025551234", created_at: `${today}T10:00:00Z` },
      { id: "2", channel: "sms", recipient: "+12025551234", created_at: `${today}T11:00:00Z` },
    ],
  });
  const r = await h.checkSmsBorrowerRateLimit("+12025551234", db as any);
  assert.equal(r.allowed, false);
  assert.ok(r.reason?.includes("sms"));
});

// ── Compliance footers ──────────────────────────────────────────────────────

test("live SMS includes STOP wording", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "live";
  const result = h.appendSmsCompliance("Hi Jane, docs needed.");
  assert.ok(result.includes("STOP"));
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("stub/dry_run SMS does not append STOP", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "stub";
  const result = h.appendSmsCompliance("Hi Jane, docs needed.");
  assert.ok(!result.includes("STOP"));
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("email footer added", () => {
  const result = h.appendEmailCompliance("Hi Jane,\n\nPlease upload documents.");
  assert.ok(result.includes("buddysba.com"));
});

test("email footer not duplicated", () => {
  const body = "Hi Jane\n\n— Buddy Brokerage Team";
  const result = h.appendEmailCompliance(body);
  assert.equal(result, body); // already has footer marker
});

// ── Env readiness panel ─────────────────────────────────────────────────────

test("env panel never displays actual secrets", () => {
  const panel = h.buildCommsEnvPanel();
  const json = JSON.stringify(panel);
  assert.ok(!json.includes("re_"), "Must not contain Resend key");
  assert.ok(!json.includes("KEY"), "Must not contain Telnyx key");
  assert.ok(!json.includes("hooks.slack"), "Must not contain Slack URL");
  assert.ok(["ready", "missing"].includes(panel.resend));
  assert.ok(["ready", "missing"].includes(panel.telnyx));
  assert.ok(["configured", "not_configured"].includes(panel.slack));
  assert.ok(["configured", "missing"].includes(panel.cron));
  assert.ok(["stub", "dry_run", "live"].includes(panel.mode));
});

// ── Metrics ─────────────────────────────────────────────────────────────────

test("metrics aggregate by channel/status/provider", async () => {
  const db = new HS({
    brokerage_comms_outbox: [
      { channel: "email", status: "sent", provider: "resend" },
      { channel: "email", status: "sent", provider: "resend" },
      { channel: "sms", status: "failed", provider: "telnyx", last_failure_code: "Telnyx 429" },
      { channel: "sms", status: "exhausted", provider: "telnyx", last_failure_code: "Telnyx 503" },
      { channel: "slack", status: "sent", provider: "slack" },
      { channel: "email", status: "retry_scheduled", provider: "resend" },
    ],
  });
  const m = await h.computeCommsMetrics(db as any);
  assert.equal(m.byChannel.email, 3);
  assert.equal(m.byChannel.sms, 2);
  assert.equal(m.byChannel.slack, 1);
  assert.equal(m.byStatus.sent, 3);
  assert.equal(m.byStatus.failed, 1);
  assert.equal(m.byStatus.exhausted, 1);
  assert.equal(m.byProvider.resend, 3);
  assert.equal(m.byProvider.telnyx, 2);
  assert.equal(m.retryCount, 1);
  assert.equal(m.exhaustedCount, 1);
  assert.equal(m.failureClasses["Telnyx 429"], 1);
  assert.equal(m.failureClasses["Telnyx 503"], 1);
});

// ── Auth ────────────────────────────────────────────────────────────────────

test("cron still accepts valid CRON_SECRET", () => {
  const orig = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "valid-secret";
  const r = verifyCronSecret({ headers: { get: (k: string) => k === "x-cron-secret" ? "valid-secret" : null } } as any);
  assert.equal(r.authorized, true);
  process.env.CRON_SECRET = orig;
});

// ── Response safety ─────────────────────────────────────────────────────────

test("all responses remain redacted", () => {
  const dirty = { RESEND_API_KEY: "re_test123456789abc", TELNYX_API_KEY: "KEY01234567890123456789abc", ok: true };
  const clean = redactResponseSecrets(dirty);
  const json = JSON.stringify(clean);
  assert.ok(!json.includes("re_test123456789abc"));
  assert.ok(!json.includes("KEY01234567890123456789abc"));
  assert.ok(json.includes("[REDACTED]"));
});

// ── Capped sends emit skip ──────────────────────────────────────────────────

test("capped sends return skip reason", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const db = new HS({
    brokerage_comms_outbox: [
      { id: "1", deal_id: "d1", trigger_key: "missing_documents", created_at: `${today}T10:00:00Z` },
      { id: "2", deal_id: "d1", trigger_key: "missing_documents", created_at: `${today}T11:00:00Z` },
    ],
  });
  const r = await h.checkDealNudgeRateLimit("d1", db as any);
  assert.equal(r.allowed, false);
  assert.ok(r.reason, "Must include skip reason for capped sends");
});
