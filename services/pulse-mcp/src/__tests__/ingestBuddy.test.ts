import test from "node:test";
import assert from "node:assert/strict";

// ─── Source-level structural tests for ingestBuddy.ts ──────────────────────

const INGEST_PATH = "services/pulse-mcp/src/routes/ingestBuddy.ts";

function readSource(): string {
  const fs = require("node:fs");
  return fs.readFileSync(INGEST_PATH, "utf-8");
}

// ─── HMAC verification ─────────────────────────────────────────────────────

test("ingest: uses HMAC-SHA256 signature verification", () => {
  const source = readSource();
  assert.ok(source.includes("createHmac"), "Must use createHmac for signature");
  assert.ok(source.includes("x-pulse-signature"), "Must check x-pulse-signature header");
  assert.ok(source.includes("timingSafeEqual"), "Must use timing-safe comparison");
  assert.ok(source.includes("PULSE_BUDDY_INGEST_SECRET"), "Must use PULSE_BUDDY_INGEST_SECRET");
});

test("ingest: rejects missing or invalid signatures", () => {
  const source = readSource();
  assert.ok(source.includes('"invalid signature"'), "Must return invalid signature error");
  assert.ok(source.includes("401"), "Must return 401 on bad signature");
});

// ─── Dual-path routing ─────────────────────────────────────────────────────

test("ingest: routes observer events via product === buddy", () => {
  const source = readSource();
  assert.ok(
    source.includes('body.product !== "buddy"'),
    "Must check product field for observer events",
  );
  assert.ok(
    source.includes("isValidObserverPayload"),
    "Must have observer payload validator",
  );
});

test("ingest: routes ledger events via source === buddy", () => {
  const source = readSource();
  assert.ok(
    source.includes('body.source !== "buddy"'),
    "Must check source field for ledger events",
  );
  assert.ok(
    source.includes("isValidLedgerPayload"),
    "Must have ledger payload validator",
  );
});

test("ingest: ledger validator checks required fields", () => {
  const source = readSource();
  assert.ok(source.includes("body.env"), "Must validate env");
  assert.ok(source.includes("body.deal_id"), "Must validate deal_id");
  assert.ok(source.includes("body.event_key"), "Must validate event_key");
  assert.ok(source.includes("body.created_at"), "Must validate created_at");
  assert.ok(source.includes("body.trace_id"), "Must validate trace_id");
});

// ─── Ledger event persistence ───────────────────────────────────────────────

test("ingest: stores ledger events in buddy_ledger_events table", () => {
  const source = readSource();
  assert.ok(
    source.includes('"buddy_ledger_events"'),
    "Must reference buddy_ledger_events table",
  );
});

test("ingest: ledger upsert uses trace_id for idempotency", () => {
  const source = readSource();
  assert.ok(
    source.includes('onConflict: "trace_id"'),
    "Must upsert on trace_id conflict",
  );
  assert.ok(
    source.includes("ignoreDuplicates: true"),
    "Must ignore duplicates on conflict",
  );
});

test("ingest: maps PulseEvent fields correctly", () => {
  const source = readSource();
  assert.ok(source.includes("event_created_at: body.created_at"), "Must map created_at → event_created_at");
  assert.ok(source.includes("trace_id: body.trace_id"), "Must map trace_id");
  assert.ok(source.includes("event_key: body.event_key"), "Must map event_key");
  assert.ok(source.includes("bank_id: body.bank_id"), "Must map bank_id");
});

// ─── Observer event persistence (unchanged) ─────────────────────────────────

test("ingest: observer events still go to buddy_observer_events", () => {
  const source = readSource();
  assert.ok(
    source.includes('"buddy_observer_events"'),
    "Must reference buddy_observer_events table",
  );
});

test("ingest: observer events still upsert deal state", () => {
  const source = readSource();
  assert.ok(
    source.includes('"buddy_deal_state"'),
    "Must reference buddy_deal_state table",
  );
  assert.ok(
    source.includes('onConflict: "deal_id"'),
    "Must upsert deal state on deal_id",
  );
});

// ─── Response codes ─────────────────────────────────────────────────────────

test("ingest: returns 202 on success", () => {
  const source = readSource();
  const count202 = (source.match(/status\(202\)/g) || []).length;
  assert.ok(count202 >= 2, `Must return 202 from both handlers, found ${count202}`);
});

test("ingest: returns 400 on invalid payload", () => {
  const source = readSource();
  assert.ok(
    source.includes('"invalid payload"'),
    "Must return invalid payload error for unrecognized bodies",
  );
});

test("ingest: returns 500 on missing secret", () => {
  const source = readSource();
  assert.ok(
    source.includes('"missing PULSE_BUDDY_INGEST_SECRET"'),
    "Must return error when secret is missing",
  );
});

// ─── Migration structural tests ─────────────────────────────────────────────

test("migration: buddy_ledger_events table has correct columns", () => {
  const fs = require("node:fs");
  const migration = fs.readFileSync("supabase/migrations/20260129_buddy_ledger_events.sql", "utf-8");

  assert.ok(migration.includes("buddy_ledger_events"), "Must create buddy_ledger_events table");
  assert.ok(migration.includes("trace_id text not null unique"), "trace_id must be NOT NULL UNIQUE");
  assert.ok(migration.includes("deal_id text not null"), "deal_id must be NOT NULL");
  assert.ok(migration.includes("event_key text not null"), "event_key must be NOT NULL");
  assert.ok(migration.includes("env text not null"), "env must be NOT NULL");
  assert.ok(migration.includes("event_created_at timestamptz not null"), "event_created_at must exist");
  assert.ok(migration.includes("bank_id text null"), "bank_id must be nullable");
  assert.ok(migration.includes("payload jsonb"), "payload must be jsonb");
});

test("migration: buddy_ledger_events has RLS enabled", () => {
  const fs = require("node:fs");
  const migration = fs.readFileSync("supabase/migrations/20260129_buddy_ledger_events.sql", "utf-8");

  assert.ok(
    migration.includes("enable row level security"),
    "Must enable RLS",
  );
  assert.ok(
    migration.includes("deny_all"),
    "Must have deny_all policy",
  );
});

test("migration: buddy_ledger_events has performance indexes", () => {
  const fs = require("node:fs");
  const migration = fs.readFileSync("supabase/migrations/20260129_buddy_ledger_events.sql", "utf-8");

  assert.ok(migration.includes("buddy_ledger_events_deal_id_idx"), "Must have deal_id index");
  assert.ok(migration.includes("buddy_ledger_events_event_key_idx"), "Must have event_key index");
  assert.ok(migration.includes("buddy_ledger_events_env_idx"), "Must have env index");
});

// ─── Tool registration tests ────────────────────────────────────────────────

test("tools: buddy_list_ledger_events is registered (underscore name)", () => {
  const fs = require("node:fs");
  const registry = fs.readFileSync("services/pulse-mcp/src/tools/index.ts", "utf-8");

  assert.ok(
    registry.includes('"buddy_list_ledger_events"'),
    "Must register buddy_list_ledger_events tool",
  );
  assert.ok(
    registry.includes('"buddy_get_deal_ledger"'),
    "Must register buddy_get_deal_ledger tool",
  );
});

test("tools: ledger tools are in read-only allowlist (underscore names)", () => {
  const fs = require("node:fs");
  const allowlist = fs.readFileSync("services/pulse-mcp/src/allowlist.ts", "utf-8");

  assert.ok(
    allowlist.includes('"buddy_list_ledger_events"'),
    "buddy_list_ledger_events must be in READ_TOOLS",
  );
  assert.ok(
    allowlist.includes('"buddy_get_deal_ledger"'),
    "buddy_get_deal_ledger must be in READ_TOOLS",
  );
});

test("tools: ledger tools query buddy_ledger_events table", () => {
  const fs = require("node:fs");
  const tools = fs.readFileSync("services/pulse-mcp/src/tools/buddy/ledger.ts", "utf-8");

  const ledgerTableRefs = (tools.match(/"buddy_ledger_events"/g) || []).length;
  assert.ok(
    ledgerTableRefs >= 2,
    `Must query buddy_ledger_events in at least 2 tools, found ${ledgerTableRefs}`,
  );
});

// ─── Integration contract: forwarder → ingest ───────────────────────────────

test("integration: forwarder PulseEvent schema matches ingest validator", () => {
  const fs = require("node:fs");
  const forwarder = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");
  const ingest = fs.readFileSync(INGEST_PATH, "utf-8");

  // Forwarder sends source: "buddy"
  assert.ok(forwarder.includes('source: "buddy"'), "Forwarder must set source: buddy");
  // Ingest checks source: "buddy"
  assert.ok(ingest.includes('body.source !== "buddy"'), "Ingest must check source: buddy");

  // All PulseEvent fields must be validated or mapped
  const pulseFields = ["env", "deal_id", "event_key", "created_at", "trace_id"];
  for (const field of pulseFields) {
    assert.ok(
      ingest.includes(`body.${field}`),
      `Ingest must reference body.${field} from PulseEvent`,
    );
  }
});

test("integration: forwarder signs with same HMAC as ingest verifies", () => {
  const fs = require("node:fs");
  const forwarder = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");
  const ingest = fs.readFileSync(INGEST_PATH, "utf-8");

  // Both use sha256 HMAC
  assert.ok(forwarder.includes('createHmac("sha256"'), "Forwarder must use SHA-256 HMAC");
  assert.ok(ingest.includes('createHmac("sha256"'), "Ingest must use SHA-256 HMAC");

  // Both reference x-pulse-signature header
  assert.ok(forwarder.includes("x-pulse-signature"), "Forwarder must send x-pulse-signature");
  assert.ok(ingest.includes("x-pulse-signature"), "Ingest must check x-pulse-signature");

  // Both use PULSE_BUDDY_INGEST_SECRET
  assert.ok(forwarder.includes("PULSE_BUDDY_INGEST_SECRET"), "Forwarder must use PULSE_BUDDY_INGEST_SECRET");
  assert.ok(ingest.includes("PULSE_BUDDY_INGEST_SECRET"), "Ingest must use PULSE_BUDDY_INGEST_SECRET");
});
