import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsRollout") as typeof import("../commsRollout");

function saveEnv() {
  return { mode: process.env.BROKERAGE_COMMS_MODE, resend: process.env.RESEND_API_KEY, from: process.env.BROKERAGE_FROM_EMAIL, telnyx: process.env.TELNYX_API_KEY, telnyxFrom: process.env.TELNYX_FROM_NUMBER, cron: process.env.CRON_SECRET, clerk: process.env.CLERK_SECRET_KEY, slack: process.env.BROKERAGE_SLACK_WEBHOOK_URL, allow: process.env.ALLOW_LIVE_COMMS_QA };
}
function restoreEnv(s: ReturnType<typeof saveEnv>) {
  const set = (k: string, v: string | undefined) => { if (v !== undefined) process.env[k] = v; else delete process.env[k]; };
  set("BROKERAGE_COMMS_MODE", s.mode); set("RESEND_API_KEY", s.resend); set("BROKERAGE_FROM_EMAIL", s.from); set("TELNYX_API_KEY", s.telnyx); set("TELNYX_FROM_NUMBER", s.telnyxFrom); set("CRON_SECRET", s.cron); set("CLERK_SECRET_KEY", s.clerk); set("BROKERAGE_SLACK_WEBHOOK_URL", s.slack); set("ALLOW_LIVE_COMMS_QA", s.allow);
}

// ── Readiness ───────────────────────────────────────────────────────────────

test("readiness exits 0 in stub with warnings", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "stub";
  delete process.env.RESEND_API_KEY;
  const r = m.runReadinessCheck();
  assert.equal(r.exitCode, 0);
  assert.ok(r.readiness.status === "ready" || r.readiness.status === "warning");
  restoreEnv(saved);
});

test("readiness exits 0 in dry_run with warnings", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "dry_run";
  const r = m.runReadinessCheck();
  assert.equal(r.exitCode, 0);
  restoreEnv(saved);
});

test("readiness exits 1 when live blocked", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.RESEND_API_KEY;
  delete process.env.TELNYX_API_KEY;
  delete process.env.CRON_SECRET;
  delete process.env.CLERK_SECRET_KEY;
  const r = m.runReadinessCheck();
  assert.equal(r.exitCode, 1);
  assert.equal(r.readiness.status, "blocked");
  restoreEnv(saved);
});

// ── Dry-run ─────────────────────────────────────────────────────────────────

test("dry-run refuses live mode", async () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  const r = await m.runDryRunVerification();
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes("live"));
  restoreEnv(saved);
});

test("dry-run runs QA safely in stub", async () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "stub";
  process.env.BROKERAGE_BANKER_EMAIL = "qa@test.com";
  const r = await m.runDryRunVerification();
  assert.equal(r.ok, true);
  assert.ok(r.qaResult);
  assert.equal(r.qaResult!.passed, true);
  assert.equal(r.qaResult!.scenarioCount, 7);
  restoreEnv(saved);
});

// ── Live preflight ──────────────────────────────────────────────────────────

test("live-preflight refuses non-live mode", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "stub";
  const r = m.runLivePreflight();
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes("not live"));
  restoreEnv(saved);
});

test("live-preflight does not send", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_test";
  process.env.BROKERAGE_FROM_EMAIL = "t@t.com";
  process.env.TELNYX_API_KEY = "KEY_test";
  process.env.TELNYX_FROM_NUMBER = "+10000000000";
  process.env.CRON_SECRET = "s";
  process.env.CLERK_SECRET_KEY = "s";
  const r = m.runLivePreflight();
  assert.equal(r.ok, true);
  assert.ok(r.wouldEnable.length >= 2);
  assert.equal(r.blocked.length, 0);
  // No network call made — this is a pure check
  restoreEnv(saved);
});

// ── Output safety ───────────────────────────────────────────────────────────

test("readiness output redacts secrets", () => {
  const saved = saveEnv();
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.RESEND_API_KEY = "re_supersecret123456";
  process.env.CRON_SECRET = "my-cron-secret";
  const r = m.runReadinessCheck();
  const json = JSON.stringify(r);
  assert.ok(!json.includes("re_supersecret123456"));
  assert.ok(!json.includes("my-cron-secret"));
  restoreEnv(saved);
});

// ── Docs ────────────────────────────────────────────────────────────────────

test("rollout docs exist and mention rollback", () => {
  const path = resolve(process.cwd(), "docs/brokerage-comms-live-rollout.md");
  assert.ok(existsSync(path), "Rollout doc must exist");
  const { readFileSync } = require("node:fs");
  const content = readFileSync(path, "utf-8");
  assert.ok(content.includes("Rollback"), "Must mention rollback");
  assert.ok(content.includes("Emergency"), "Must mention emergency disable");
  assert.ok(content.includes("stub"), "Must mention stub mode");
});
