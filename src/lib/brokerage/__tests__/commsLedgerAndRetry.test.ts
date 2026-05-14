import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ledger = require("../commsLedger") as typeof import("../commsLedger");
const retry = require("../commsRetryQueue") as typeof import("../commsRetryQueue");

type Row = Record<string, any>;

class LS {
  tables: Record<string, Row[]>;
  constructor() { this.tables = { brokerage_comms_ledger: [] }; }
  from(t: string) { return new LQ(this, t); }
}

class LQ {
  db: LS; table: string; _i: Row[] | null;
  constructor(db: LS, t: string) { this.db = db; this.table = t; this._i = null; }
  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows);
    this._i = rows; return this;
  }
  then(f: any, r?: any) { return Promise.resolve({ data: this._i, error: null }).then(f, r); }
}

// ── Ledger events ───────────────────────────────────────────────────────────

test("requested event is generated", async () => {
  const db = new LS();
  await ledger.recordCommsSendRequested(db as any, { channel: "email", recipient: "test@example.com", dealId: "d1", triggerKey: "funded" });
  assert.equal(db.tables.brokerage_comms_ledger.length, 1);
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_send_requested");
  assert.equal(db.tables.brokerage_comms_ledger[0].channel, "email");
  assert.equal(db.tables.brokerage_comms_ledger[0].deal_id, "d1");
});

test("succeeded event stores providerMessageId", async () => {
  const db = new LS();
  await ledger.recordCommsSendSucceeded(db as any, { channel: "sms", recipient: "+12025551234", providerMessageId: "telnyx-msg-123" });
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_send_succeeded");
  assert.equal(db.tables.brokerage_comms_ledger[0].provider_message_id, "telnyx-msg-123");
});

test("failed event is generated", async () => {
  const db = new LS();
  await ledger.recordCommsSendFailed(db as any, { channel: "email", recipient: "test@x.com", failureCode: "Resend 429", retryable: true, attemptNumber: 1 });
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_send_failed");
  assert.equal(db.tables.brokerage_comms_ledger[0].retryable, true);
  assert.equal(db.tables.brokerage_comms_ledger[0].attempt_number, 1);
});

// ── Recipient masking ───────────────────────────────────────────────────────

test("email recipients are masked", async () => {
  const db = new LS();
  await ledger.recordCommsSendRequested(db as any, { channel: "email", recipient: "john.doe@company.com" });
  const masked = db.tables.brokerage_comms_ledger[0].recipient_masked;
  assert.ok(!masked.includes("john.doe"), "Full email local part should be masked");
  assert.ok(masked.includes("@company.com"), "Domain should be preserved");
  assert.ok(masked.includes("*"), "Should contain mask characters");
});

test("SMS recipients are masked", async () => {
  const db = new LS();
  await ledger.recordCommsSendRequested(db as any, { channel: "sms", recipient: "+12025551234" });
  const masked = db.tables.brokerage_comms_ledger[0].recipient_masked;
  assert.ok(!masked.includes("+120255"), "Most digits should be masked");
  assert.ok(masked.endsWith("1234"), "Last 4 digits preserved");
  assert.ok(masked.includes("*"), "Should contain mask characters");
});

test("masking functions work correctly", () => {
  assert.equal(ledger.maskEmail("john@example.com"), "j**n@example.com");
  assert.equal(ledger.maskPhone("+12025551234"), "********1234");
  assert.equal(ledger.maskRecipient("ops-channel", "slack"), "ops-channel");
});

// ── Secret scrubbing ────────────────────────────────────────────────────────

test("secrets are scrubbed from failure codes", async () => {
  const db = new LS();
  await ledger.recordCommsSendFailed(db as any, {
    channel: "email", recipient: "x@y.com",
    failureCode: "Bearer re_abc123defghijklmnop failed with RESEND_API_KEY error",
    retryable: false,
  });
  const fc = db.tables.brokerage_comms_ledger[0].failure_code;
  assert.ok(!fc.includes("re_abc123defghijklmnop"), "API key should be scrubbed");
  assert.ok(!fc.includes("RESEND_API_KEY"), "Env var name should be scrubbed");
  assert.ok(fc.includes("[REDACTED]"));
});

// ── Retry queue ─────────────────────────────────────────────────────────────

test("retryable failure schedules retry", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: false, error: "Telnyx 429", retryable: true }, 1);
  assert.equal(d.shouldRetry, true);
  assert.equal(d.retryable, true);
  assert.ok(d.nextDelaySec! > 0);
  assert.equal(d.exhausted, false);
});

test("non-retryable failure does not schedule retry", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: false, error: "Invalid E.164", retryable: false }, 1);
  assert.equal(d.shouldRetry, false);
  assert.equal(d.retryable, false);
  assert.equal(d.nextDelaySec, null);
});

test("exhausted after max attempts", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: false, error: "Telnyx 503", retryable: true }, 3);
  assert.equal(d.shouldRetry, false);
  assert.equal(d.exhausted, true);
  assert.equal(d.retryable, true);
});

test("success returns no retry", () => {
  const d = retry.normalizeSendResultToRetryDecision({ ok: true, providerMessageId: "msg-1" }, 1);
  assert.equal(d.shouldRetry, false);
  assert.equal(d.failureCode, "");
});

test("429 is retryable status", () => {
  assert.equal(retry.isRetryableStatus(429), true);
  assert.equal(retry.isRetryableStatus(500), true);
  assert.equal(retry.isRetryableStatus(503), true);
});

test("4xx is non-retryable status", () => {
  assert.equal(retry.isNonRetryableStatus(400), true);
  assert.equal(retry.isNonRetryableStatus(401), true);
  assert.equal(retry.isNonRetryableStatus(403), true);
  assert.equal(retry.isNonRetryableStatus(422), true);
  assert.equal(retry.isNonRetryableStatus(429), false); // 429 is retryable
});

test("exponential delay increases", () => {
  const d1 = retry.normalizeSendResultToRetryDecision({ ok: false, error: "err", retryable: true }, 1);
  const d2 = retry.normalizeSendResultToRetryDecision({ ok: false, error: "err", retryable: true }, 2);
  assert.ok(d1.nextDelaySec! < d2.nextDelaySec!);
});

// ── Stub mode produces ledger events ────────────────────────────────────────

test("stub mode still produces ledger events", async () => {
  const db = new LS();
  await ledger.recordCommsSendRequested(db as any, { channel: "email", recipient: "stub@test.com", triggerKey: "session_started" });
  await ledger.recordCommsSendSucceeded(db as any, { channel: "email", recipient: "stub@test.com", providerMessageId: "stub-email-123" });
  assert.equal(db.tables.brokerage_comms_ledger.length, 2);
  assert.equal(db.tables.brokerage_comms_ledger[0].event_type, "brokerage_comms_send_requested");
  assert.equal(db.tables.brokerage_comms_ledger[1].event_type, "brokerage_comms_send_succeeded");
  assert.equal(db.tables.brokerage_comms_ledger[1].provider_message_id, "stub-email-123");
});

// ── Retry scheduled / exhausted ledger events ───────────────────────────────

test("retry scheduled event has delay metadata", async () => {
  const db = new LS();
  await ledger.recordCommsRetryScheduled(db as any, { channel: "sms", recipient: "+12025551234", attemptNumber: 2, nextAttemptDelaySec: 120 });
  const e = db.tables.brokerage_comms_ledger[0];
  assert.equal(e.event_type, "brokerage_comms_retry_scheduled");
  assert.equal(e.metadata.nextAttemptDelaySec, 120);
  assert.equal(e.attempt_number, 2);
});

test("retry exhausted event marks non-retryable", async () => {
  const db = new LS();
  await ledger.recordCommsRetryExhausted(db as any, { channel: "email", recipient: "x@y.com", totalAttempts: 3, lastFailureCode: "Resend 503" });
  const e = db.tables.brokerage_comms_ledger[0];
  assert.equal(e.event_type, "brokerage_comms_retry_exhausted");
  assert.equal(e.retryable, false);
  assert.equal(e.attempt_number, 3);
});
