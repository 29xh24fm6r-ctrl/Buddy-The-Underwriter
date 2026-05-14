import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const m = require("../commsQaHarness") as typeof import("../commsQaHarness");

// Save/restore env
let origBankerEmail: string | undefined;
let origMode: string | undefined;
test.before(() => { origBankerEmail = process.env.BROKERAGE_BANKER_EMAIL; origMode = process.env.BROKERAGE_COMMS_MODE; process.env.BROKERAGE_BANKER_EMAIL = "qa-banker@test.com"; });
test.after(() => { process.env.BROKERAGE_BANKER_EMAIL = origBankerEmail; process.env.BROKERAGE_COMMS_MODE = origMode; });

// ── All scenarios pass deterministically ────────────────────────────────────

test("missing_docs_email_only scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("missing_docs_email_only");
  const r = await m.runCommsQaScenario("missing_docs_email_only", db as any);
  assert.equal(r.passed, true, `Failed checks: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("missing_docs_sms_opted_in scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("missing_docs_sms_opted_in");
  const r = await m.runCommsQaScenario("missing_docs_sms_opted_in", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("missing_docs_sms_no_opt_in scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("missing_docs_sms_no_opt_in");
  const r = await m.runCommsQaScenario("missing_docs_sms_no_opt_in", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("provider_retry_then_success scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("provider_retry_then_success");
  const r = await m.runCommsQaScenario("provider_retry_then_success", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("provider_retry_exhausted scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("provider_retry_exhausted");
  const r = await m.runCommsQaScenario("provider_retry_exhausted", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("banker_alert_ready_for_review scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("banker_alert_ready_for_review");
  const r = await m.runCommsQaScenario("banker_alert_ready_for_review", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

test("closed_deal_skipped scenario passes", async () => {
  const { db } = m.seedCommsQaScenario("closed_deal_skipped");
  const r = await m.runCommsQaScenario("closed_deal_skipped", db as any);
  assert.equal(r.passed, true, `Failed: ${r.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join(", ")}`);
});

// ── Full run ────────────────────────────────────────────────────────────────

test("all scenarios pass in full run", async () => {
  const r = await m.runAllCommsQaScenarios();
  assert.equal(r.passed, true, `Failed scenarios: ${r.scenarios.filter(s => !s.passed).map(s => s.name).join(", ")}`);
  assert.equal(r.scenarios.length, 7);
});

// ── Live mode guard ─────────────────────────────────────────────────────────

test("harness refuses live mode by default", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "live";
  const r = m.assertQaSafeMode();
  assert.equal(r.safe, false);
  assert.ok(r.reason?.includes("live"));
  process.env.BROKERAGE_COMMS_MODE = orig;
});

test("stub mode is safe", () => {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  process.env.BROKERAGE_COMMS_MODE = "stub";
  assert.equal(m.assertQaSafeMode().safe, true);
  process.env.BROKERAGE_COMMS_MODE = orig;
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

test("cleanup removes QA records", () => {
  const { db } = m.seedCommsQaScenario("missing_docs_email_only");
  assert.ok(db.tables.deals.length > 0);
  m.cleanupCommsQaScenario(db);
  assert.equal(db.tables.deals.length, 0);
});

// ── Invariants ──────────────────────────────────────────────────────────────

test("invariants catch secrets in ledger", () => {
  const db = new m.QaStub();
  db.tables.brokerage_comms_ledger.push({
    event_type: "test", recipient_masked: "m***d@x.com",
    metadata: { error: "Bearer re_abc123defghijklm failed" },
  });
  // Note: this specific check looks for RESEND_API_KEY string, not Bearer patterns
  // The invariant checks for the env var name patterns
  const r = m.assertCommsQaInvariants(db);
  // Bearer with 10+ chars should be caught
  assert.equal(r.ok, false);
});

test("invariants pass on clean ledger", () => {
  const db = new m.QaStub();
  db.tables.brokerage_comms_ledger.push({
    event_type: "test", recipient_masked: "m***d@x.com",
    metadata: { error: "Telnyx 429" },
  });
  const r = m.assertCommsQaInvariants(db);
  assert.equal(r.ok, true);
});
