import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../commsAdapters") as typeof import("../commsAdapters");

// ── E.164 validation ────────────────────────────────────────────────────────

test("valid E.164 numbers", () => {
  assert.equal(m.isValidE164("+12025551234"), true);
  assert.equal(m.isValidE164("+442071234567"), true);
  assert.equal(m.isValidE164("+5511987654321"), true);
});

test("invalid E.164 numbers", () => {
  assert.equal(m.isValidE164("2025551234"), false);     // no +
  assert.equal(m.isValidE164("+0123456789"), false);     // starts with 0
  assert.equal(m.isValidE164("+1"), false);              // too short
  assert.equal(m.isValidE164(""), false);
  assert.equal(m.isValidE164("not-a-number"), false);
});

// ── Telnyx adapter (stub mode) ──────────────────────────────────────────────

test("Telnyx stub returns providerMessageId", async () => {
  // Default mode is stub when BROKERAGE_COMMS_MODE not set
  const adapter = m.createTelnyxSmsAdapter();
  const r = await adapter({ recipient: "+12025551234", body: "Test" });
  assert.equal(r.ok, true);
  assert.ok(r.providerMessageId?.startsWith("stub-sms-"));
});

test("Telnyx requires E.164 in live mode", async () => {
  const origMode = process.env.BROKERAGE_COMMS_MODE;
  const origKey = process.env.TELNYX_API_KEY;
  const origFrom = process.env.TELNYX_FROM_NUMBER;
  process.env.BROKERAGE_COMMS_MODE = "live";
  process.env.TELNYX_API_KEY = "test-key";
  process.env.TELNYX_FROM_NUMBER = "+10000000000";

  const adapter = m.createTelnyxSmsAdapter();
  const r = await adapter({ recipient: "bad-number", body: "Test" });
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes("E.164"));
  assert.equal(r.retryable, false);

  process.env.BROKERAGE_COMMS_MODE = origMode;
  process.env.TELNYX_API_KEY = origKey;
  process.env.TELNYX_FROM_NUMBER = origFrom;
});

// ── Env readiness ───────────────────────────────────────────────────────────

test("missing Telnyx env is warning in dry_run", () => {
  const origMode = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "dry_run";
  const status = m.assertCommsEnvReady();
  assert.equal(status.mode, "dry_run");
  // Should have warnings, not criticals for missing keys
  assert.ok(status.issues.some(i => i.includes("warning") || i.includes("not set")));
  process.env.BROKERAGE_COMMS_MODE = origMode;
});

test("missing Telnyx env is critical in live mode", () => {
  const origMode = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "live";
  const status = m.assertCommsEnvReady();
  assert.equal(status.mode, "live");
  assert.ok(status.issues.some(i => i.includes("critical")));
  process.env.BROKERAGE_COMMS_MODE = origMode;
});

// ── Secrets redaction ───────────────────────────────────────────────────────

test("redacts API keys", () => {
  const input = "Error with Bearer re_abc123defghijklm token";
  const result = m.redactCommsSecrets(input);
  assert.ok(!result.includes("re_abc123defghijklm"));
  assert.ok(result.includes("[REDACTED]"));
});

test("redacts Telnyx-style keys", () => {
  const input = "Auth failed: KEY01234567890123456789abc";
  const result = m.redactCommsSecrets(input);
  assert.ok(!result.includes("KEY01234567890123456789abc"));
});

// ── Email adapter (stub mode) ───────────────────────────────────────────────

test("Resend stub returns ok", async () => {
  const adapter = m.createEmailAdapter();
  const r = await adapter({ recipient: "test@test.com", subject: "Test", body: "Hello" });
  assert.equal(r.ok, true);
  assert.ok(r.providerMessageId?.startsWith("stub-email-"));
});

// ── Slack adapter ───────────────────────────────────────────────────────────

test("Slack stub returns ok", async () => {
  const adapter = m.createSlackAdapter();
  const r = await adapter({ body: "Alert: test" });
  assert.equal(r.ok, true);
});

test("Slack without webhook silently succeeds in live mode", async () => {
  const origMode = process.env.BROKERAGE_COMMS_MODE;
  const origUrl = process.env.SLACK_WEBHOOK_URL;
  process.env.BROKERAGE_COMMS_MODE = "live";
  delete process.env.SLACK_WEBHOOK_URL;

  const adapter = m.createSlackAdapter();
  const r = await adapter({ body: "Alert" });
  assert.equal(r.ok, true); // Slack is optional

  process.env.BROKERAGE_COMMS_MODE = origMode;
  if (origUrl) process.env.SLACK_WEBHOOK_URL = origUrl;
});

// ── Factory ─────────────────────────────────────────────────────────────────

test("factory creates all adapters", () => {
  const adapters = m.createBrokerageCommsAdaptersFromEnv();
  assert.equal(typeof adapters.email, "function");
  assert.equal(typeof adapters.sms, "function");
  assert.equal(typeof adapters.slack, "function");
});

// ── Comms mode ──────────────────────────────────────────────────────────────

test("default mode is stub", () => {
  const origMode = process.env.BROKERAGE_COMMS_MODE;
  delete process.env.BROKERAGE_COMMS_MODE;
  assert.equal(m.getCommsMode(), "stub");
  if (origMode) process.env.BROKERAGE_COMMS_MODE = origMode;
});
