import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

const client = read("src/app/admin/brokerage/comms/CommsAdminClient.tsx");

// ── Mode banner ─────────────────────────────────────────────────────────────

test("renders comms mode banner", () => {
  assert.ok(client.includes("comms-mode-banner"), "Must have comms mode banner testid");
  assert.ok(client.includes("Communications mode"), "Must show mode label");
  assert.ok(client.includes("STUB") || client.includes("stub") || client.includes("mode.toUpperCase()"), "Must display mode value");
});

test("live mode warning appears", () => {
  assert.ok(client.includes("real messages"), "Must warn about real messages in live mode");
});

// ── Controls ────────────────────────────────────────────────────────────────

test("run comms check calls enqueue-only route", () => {
  assert.ok(client.includes("run-comms-check"), "Must have run comms check button testid");
  assert.ok(client.includes("processOutbox: false") || client.includes("runDealComms(false)"), "Default must be enqueue-only");
});

test("process outbox requires confirmation", () => {
  assert.ok(client.includes("confirm-dialog"), "Must have confirmation dialog testid");
  assert.ok(client.includes("Confirm"), "Must have confirm button text");
  assert.ok(client.includes("Cancel"), "Must have cancel button text");
  assert.ok(client.includes("confirmProcessOutbox"), "Must send confirmation flag to outbox route");
});

// ── Outbox table ────────────────────────────────────────────────────────────

test("outbox table masks recipients", () => {
  assert.ok(client.includes("recipient_masked"), "Must use masked recipient field");
  assert.ok(client.includes("outbox-table"), "Must have outbox table testid");
});

// ── Ledger timeline ─────────────────────────────────────────────────────────

test("ledger timeline renders safe event metadata", () => {
  assert.ok(client.includes("ledger-timeline"), "Must have ledger timeline testid");
  assert.ok(client.includes("event_type"), "Must show event type");
  assert.ok(client.includes("recipient_masked"), "Must show masked recipient");
});

// ── Batch ───────────────────────────────────────────────────────────────────

test("batch limit selector caps at 100", () => {
  assert.ok(client.includes("limit-selector"), "Must have limit selector testid");
  assert.ok(client.includes("100"), "Must include 100 as option");
  // Should not have options above 100
  assert.ok(!client.includes("value={200}") && !client.includes("value={500}"), "Must not exceed 100");
});

// ── Safety ──────────────────────────────────────────────────────────────────

test("no secrets rendered in client component", () => {
  assert.ok(!client.includes("RESEND_API_KEY"), "Must not contain RESEND_API_KEY");
  assert.ok(!client.includes("TELNYX_API_KEY"), "Must not contain TELNYX_API_KEY");
  assert.ok(!client.includes("SLACK_WEBHOOK_URL"), "Must not contain SLACK_WEBHOOK_URL");
  assert.ok(!client.includes("Bearer"), "Must not contain Bearer token");
  assert.ok(!client.includes("service_role_key"), "Must not contain service_role_key");
});
