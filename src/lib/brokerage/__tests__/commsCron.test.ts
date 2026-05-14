import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsCron") as typeof import("../commsCron");

type Row = Record<string, any>;

// ── Mock Request ────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

// ── Stub DB ─────────────────────────────────────────────────────────────────

class CS {
  tables: Record<string, Row[]>;
  constructor() { this.tables = { brokerage_comms_ledger: [] }; }
  from(t: string) { return new CQ(this, t); }
}
class CQ {
  db: CS; table: string; _i: Row[] | null;
  constructor(db: CS, t: string) { this.db = db; this.table = t; this._i = null; }
  insert(p: Row | Row[]) { const rows = Array.isArray(p) ? p : [p]; this.db.tables[this.table] ??= []; this.db.tables[this.table].push(...rows); this._i = rows; return this; }
  then(f: any, r?: any) { return Promise.resolve({ data: this._i, error: null }).then(f, r); }
}

// ── Auth tests ──────────────────────────────────────────────────────────────

test("missing secret returns unauthorized", () => {
  const orig = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret-123";
  const r = m.verifyCronSecret(makeRequest());
  assert.equal(r.authorized, false);
  process.env.CRON_SECRET = orig;
});

test("invalid secret returns unauthorized", () => {
  const orig = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret-123";
  const r = m.verifyCronSecret(makeRequest({ authorization: "Bearer wrong-secret" }));
  assert.equal(r.authorized, false);
  process.env.CRON_SECRET = orig;
});

test("bearer secret accepted", () => {
  const orig = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret-123";
  const r = m.verifyCronSecret(makeRequest({ authorization: "Bearer test-secret-123" }));
  assert.equal(r.authorized, true);
  process.env.CRON_SECRET = orig;
});

test("x-cron-secret accepted", () => {
  const orig = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret-123";
  const r = m.verifyCronSecret(makeRequest({ "x-cron-secret": "test-secret-123" }));
  assert.equal(r.authorized, true);
  process.env.CRON_SECRET = orig;
});

test("no CRON_SECRET configured returns unauthorized", () => {
  const orig = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const r = m.verifyCronSecret(makeRequest({ authorization: "Bearer anything" }));
  assert.equal(r.authorized, false);
  assert.ok(r.error?.includes("not configured"));
  if (orig) process.env.CRON_SECRET = orig;
});

// ── Limit parsing ───────────────────────────────────────────────────────────

test("default limit 25", () => {
  assert.equal(m.parseCronLimit({}), 25);
  assert.equal(m.parseCronLimit({ limit: "abc" }), 25);
  assert.equal(m.parseCronLimit({ limit: -1 }), 25);
});

test("limit capped at 100", () => {
  assert.equal(m.parseCronLimit({ limit: 50 }), 50);
  assert.equal(m.parseCronLimit({ limit: 100 }), 100);
  assert.equal(m.parseCronLimit({ limit: 999 }), 100);
});

// ── Env readiness ───────────────────────────────────────────────────────────

test("stub/dry_run mode always ready", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "stub";
  assert.equal(m.checkCronEnvReadiness().ready, true);
  process.env.BROKERAGE_COMMS_MODE = "dry_run";
  assert.equal(m.checkCronEnvReadiness().ready, true);
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("live mode env readiness failure", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  const origResend = process.env.RESEND_API_KEY;
  const origTelnyx = process.env.TELNYX_API_KEY;
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.RESEND_API_KEY;
  delete process.env.TELNYX_API_KEY;
  const r = m.checkCronEnvReadiness();
  assert.equal(r.ready, false);
  assert.ok(r.issues.length > 0);
  process.env.BROKERAGE_COMMS_MODE = orig;
  if (origResend) process.env.RESEND_API_KEY = origResend;
  if (origTelnyx) process.env.TELNYX_API_KEY = origTelnyx;
});

// ── Ledger events ───────────────────────────────────────────────────────────

test("emits started ledger event", async () => {
  const db = new CS();
  await m.emitCronStarted(db as any, "stub", 25);
  assert.equal(db.tables.brokerage_comms_ledger.length, 1);
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_cron_started");
  assert.equal(db.tables.brokerage_comms_ledger[0].metadata.mode, "stub");
  assert.equal(db.tables.brokerage_comms_ledger[0].metadata.limit, 25);
});

test("emits completed ledger event", async () => {
  const db = new CS();
  await m.emitCronCompleted(db as any, { ok: true, mode: "stub", dealsProcessed: 3, totalEnqueued: 5, totalSkipped: 1, warnings: [] });
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_cron_completed");
  assert.equal(db.tables.brokerage_comms_ledger[0].metadata.dealsProcessed, 3);
});

test("emits failed ledger event", async () => {
  const db = new CS();
  await m.emitCronFailed(db as any, "test_error");
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_cron_failed");
  assert.equal(db.tables.brokerage_comms_ledger[0].metadata.error, "test_error");
});

// ── Response safety ─────────────────────────────────────────────────────────

test("responses redact secrets via commsAuth", () => {
  const { redactResponseSecrets } = require("../commsAuth") as typeof import("../commsAuth");
  const dirty = { ok: true, RESEND_API_KEY: "re_abc123defghijklm", mode: "live" };
  const clean = redactResponseSecrets(dirty);
  assert.ok(!JSON.stringify(clean).includes("re_abc123defghijklm"));
});
