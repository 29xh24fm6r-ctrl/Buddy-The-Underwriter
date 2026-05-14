import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../commsReleaseGate") as typeof import("../commsReleaseGate");

function saveEnv() {
  return {
    mode: process.env.BROKERAGE_COMMS_MODE,
    resend: process.env.RESEND_API_KEY,
    from: process.env.BROKERAGE_FROM_EMAIL,
    telnyx: process.env.TELNYX_API_KEY,
    telnyxFrom: process.env.TELNYX_FROM_NUMBER,
    cron: process.env.CRON_SECRET,
    clerk: process.env.CLERK_SECRET_KEY,
    slack: process.env.BROKERAGE_SLACK_WEBHOOK_URL,
  };
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
  const set = (k: string, v: string | undefined) => { if (v !== undefined) process.env[k] = v; else delete process.env[k]; };
  set("BROKERAGE_COMMS_MODE", saved.mode);
  set("RESEND_API_KEY", saved.resend);
  set("BROKERAGE_FROM_EMAIL", saved.from);
  set("TELNYX_API_KEY", saved.telnyx);
  set("TELNYX_FROM_NUMBER", saved.telnyxFrom);
  set("CRON_SECRET", saved.cron);
  set("CLERK_SECRET_KEY", saved.clerk);
  set("BROKERAGE_SLACK_WEBHOOK_URL", saved.slack);
}

// ── Stub mode ───────────────────────────────────────────────────────────────

test("stub mode passes with warnings", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "stub";
  delete process.env.RESEND_API_KEY;
  delete process.env.TELNYX_API_KEY;
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, true);
  assert.equal(r.mode, "stub");
  assert.ok(r.status === "ready" || r.status === "warning");
  restoreEnv(saved);
});

test("dry_run mode passes with warnings", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "dry_run";
  delete process.env.RESEND_API_KEY;
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, true);
  assert.ok(r.items.some(i => i.status === "warn"));
  restoreEnv(saved);
});

// ── Live mode ───────────────────────────────────────────────────────────────

test("live mode blocked without required env", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.RESEND_API_KEY;
  delete process.env.BROKERAGE_FROM_EMAIL;
  delete process.env.TELNYX_API_KEY;
  delete process.env.TELNYX_FROM_NUMBER;
  delete process.env.CRON_SECRET;
  delete process.env.CLERK_SECRET_KEY;
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, false);
  assert.equal(r.status, "blocked");
  assert.ok(r.items.filter(i => i.status === "fail").length >= 3);
  restoreEnv(saved);
});

test("live mode passes when all required env set", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_test123";
  process.env.BROKERAGE_FROM_EMAIL = "test@buddysba.com";
  process.env.TELNYX_API_KEY = "KEY_test123";
  process.env.TELNYX_FROM_NUMBER = "+10000000000";
  process.env.CRON_SECRET = "cron-secret";
  process.env.CLERK_SECRET_KEY = "clerk-secret";
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, true);
  assert.equal(r.status, "ready");
  assert.equal(r.items.filter(i => i.status === "fail").length, 0);
  restoreEnv(saved);
});

// ── Slack optional ──────────────────────────────────────────────────────────

test("Slack missing does not block", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_test";
  process.env.BROKERAGE_FROM_EMAIL = "t@t.com";
  process.env.TELNYX_API_KEY = "KEY_test";
  process.env.TELNYX_FROM_NUMBER = "+10000000000";
  process.env.CRON_SECRET = "s";
  process.env.CLERK_SECRET_KEY = "s";
  delete process.env.BROKERAGE_SLACK_WEBHOOK_URL;
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, true);
  const slackItem = r.items.find(i => i.name === "slack_webhook");
  assert.equal(slackItem?.status, "skip");
  restoreEnv(saved);
});

// ── Admin auth dev fallback blocks live ──────────────────────────────────────

test("admin auth dev fallback blocks live", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_test";
  process.env.BROKERAGE_FROM_EMAIL = "t@t.com";
  process.env.TELNYX_API_KEY = "KEY_test";
  process.env.TELNYX_FROM_NUMBER = "+10000000000";
  process.env.CRON_SECRET = "s";
  delete process.env.CLERK_SECRET_KEY; // triggers dev fallback
  const r = m.getCommsReleaseReadiness();
  assert.equal(r.ready, false);
  assert.ok(r.items.some(i => i.name === "admin_auth" && i.status === "fail"));
  restoreEnv(saved);
});

// ── Assert helper ───────────────────────────────────────────────────────────

test("assertCommsLiveReleaseReady returns blockers", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.RESEND_API_KEY;
  delete process.env.CLERK_SECRET_KEY;
  const r = m.assertCommsLiveReleaseReady();
  assert.equal(r.ok, false);
  assert.ok(r.blockers.length > 0);
  assert.ok(r.blockers.some(b => b.includes("resend") || b.includes("RESEND")));
  restoreEnv(saved);
});

// ── Redaction ───────────────────────────────────────────────────────────────

test("readiness status never contains actual env values", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_supersecretkey12345";
  process.env.TELNYX_API_KEY = "KEY_anothersecretkey12345";
  process.env.CRON_SECRET = "my-cron-secret-value";
  const r = m.getCommsReleaseReadiness();
  const json = JSON.stringify(r);
  assert.ok(!json.includes("re_supersecretkey12345"), "Must not contain Resend key");
  assert.ok(!json.includes("KEY_anothersecretkey12345"), "Must not contain Telnyx key");
  assert.ok(!json.includes("my-cron-secret-value"), "Must not contain cron secret");
  restoreEnv(saved);
});

// ── Checklist doc exists ────────────────────────────────────────────────────

test("checklist doc exists", () => {
  assert.ok(existsSync(resolve(process.cwd(), "docs/brokerage-comms-release-checklist.md")));
});
