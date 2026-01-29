import test from "node:test";
import assert from "node:assert/strict";

const LEDGER_PATH = "services/pulse-mcp/src/tools/buddy/ledger.ts";
const REGISTRY_PATH = "services/pulse-mcp/src/tools/index.ts";
const ALLOWLIST_PATH = "services/pulse-mcp/src/allowlist.ts";

function readSource(path: string): string {
  const fs = require("node:fs");
  return fs.readFileSync(path, "utf-8");
}

// ─── Limit clamping ─────────────────────────────────────────────────────────

test("ledger: clampLimit function exists and enforces bounds", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(source.includes("clampLimit"), "Must define clampLimit helper");
  assert.ok(source.includes("Math.max"), "Must use Math.max for lower bound");
  assert.ok(source.includes("Math.min"), "Must use Math.min for upper bound");
});

test("ledger: buddy_list_ledger_events defaults limit to 50, clamps 1–200", () => {
  const source = readSource(LEDGER_PATH);
  // Default 50
  assert.ok(
    source.includes("clampLimit(args.limit, 50, 1, 200)"),
    "Must clamp limit with default=50, min=1, max=200",
  );
});

// ─── Missing deal_id handled gracefully ─────────────────────────────────────

test("ledger: buddy_get_deal_ledger handles missing deal_id gracefully", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(
    source.includes("!args.deal_id"),
    "Must check for missing deal_id",
  );
  assert.ok(
    source.includes("Missing required parameter: deal_id"),
    "Must return helpful error message for missing deal_id",
  );
});

// ─── Registry contains both tool names ──────────────────────────────────────

test("registry: contains buddy_list_ledger_events (underscore, not dot)", () => {
  const source = readSource(REGISTRY_PATH);
  assert.ok(
    source.includes('"buddy_list_ledger_events"'),
    "Must register buddy_list_ledger_events with underscore",
  );
  // Must NOT use dot notation for ledger tools
  assert.ok(
    !source.includes('"buddy.list_ledger_events"'),
    "Must NOT use dot notation for ledger tool",
  );
});

test("registry: contains buddy_get_deal_ledger (underscore, not dot)", () => {
  const source = readSource(REGISTRY_PATH);
  assert.ok(
    source.includes('"buddy_get_deal_ledger"'),
    "Must register buddy_get_deal_ledger with underscore",
  );
  assert.ok(
    !source.includes('"buddy.get_deal_ledger"'),
    "Must NOT use dot notation for deal ledger tool",
  );
});

// ─── Router dispatch resolves exact names ───────────────────────────────────

test("dispatch: registry maps exact underscore names to handlers", () => {
  const source = readSource(REGISTRY_PATH);
  // Verify the mapping connects name → imported handler
  assert.ok(
    source.includes('"buddy_list_ledger_events": buddy_list_ledger_events'),
    "Must map exact name to handler function",
  );
  assert.ok(
    source.includes('"buddy_get_deal_ledger": buddy_get_deal_ledger'),
    "Must map exact name to handler function",
  );
});

test("dispatch: imports come from buddy/ledger module", () => {
  const source = readSource(REGISTRY_PATH);
  assert.ok(
    source.includes('from "./buddy/ledger"'),
    "Must import from ./buddy/ledger",
  );
});

// ─── Allowlist ──────────────────────────────────────────────────────────────

test("allowlist: contains both ledger tools with underscore names", () => {
  const source = readSource(ALLOWLIST_PATH);
  assert.ok(
    source.includes('"buddy_list_ledger_events"'),
    "buddy_list_ledger_events must be in READ_TOOLS",
  );
  assert.ok(
    source.includes('"buddy_get_deal_ledger"'),
    "buddy_get_deal_ledger must be in READ_TOOLS",
  );
});

// ─── Return shape compliance ────────────────────────────────────────────────

test("return shape: buddy_list_ledger_events returns { summary, artifacts }", () => {
  const source = readSource(LEDGER_PATH);
  // The function signature or return must include summary + artifacts
  const hasSummary = (source.match(/summary:/g) || []).length;
  const hasArtifacts = (source.match(/artifacts:/g) || []).length;
  assert.ok(hasSummary >= 2, `Must return summary field in multiple paths, found ${hasSummary}`);
  assert.ok(hasArtifacts >= 2, `Must return artifacts field in multiple paths, found ${hasArtifacts}`);
});

test("return shape: buddy_get_deal_ledger includes event_key_counts and timeline stats", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(source.includes("event_key_counts"), "Must compute event_key_counts");
  assert.ok(source.includes("total_events"), "Must include total_events");
  assert.ok(source.includes("first_event"), "Must include first_event");
  assert.ok(source.includes("last_event"), "Must include last_event");
});

// ─── Never throws ───────────────────────────────────────────────────────────

test("safety: both tools have try/catch wrappers", () => {
  const source = readSource(LEDGER_PATH);
  const catchCount = (source.match(/\} catch/g) || []).length;
  assert.ok(catchCount >= 2, `Must have catch blocks in both tools, found ${catchCount}`);
});

test("safety: error paths return { summary, artifacts: [] }", () => {
  const source = readSource(LEDGER_PATH);
  // On error, must return empty artifacts array
  const emptyArtifacts = (source.match(/artifacts: \[\]/g) || []).length;
  assert.ok(
    emptyArtifacts >= 3,
    `Must return empty artifacts on all error paths, found ${emptyArtifacts}`,
  );
});

// ─── Query correctness ─────────────────────────────────────────────────────

test("query: buddy_list_ledger_events orders by created_at DESC", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(
    source.includes('.order("created_at", { ascending: false })'),
    "buddy_list_ledger_events must ORDER BY created_at DESC",
  );
});

test("query: buddy_get_deal_ledger orders by created_at ASC", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(
    source.includes('.order("created_at", { ascending: true })'),
    "buddy_get_deal_ledger must ORDER BY created_at ASC",
  );
});

test("query: buddy_list_ledger_events supports after/before filters", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(source.includes("args.after"), "Must support after parameter");
  assert.ok(source.includes("args.before"), "Must support before parameter");
  assert.ok(source.includes('.gte("created_at"'), "Must filter gte for after");
  assert.ok(source.includes('.lte("created_at"'), "Must filter lte for before");
});

test("query: buddy_get_deal_ledger supports event_keys filter", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(source.includes("args.event_keys"), "Must support event_keys parameter");
  assert.ok(source.includes('.in("event_key"'), "Must filter by event_key array");
});

test("query: buddy_list_ledger_events supports bank_id filter", () => {
  const source = readSource(LEDGER_PATH);
  assert.ok(source.includes("args.bank_id"), "Must support bank_id parameter");
  assert.ok(source.includes('.eq("bank_id"'), "Must filter by bank_id");
});

// ─── Reads only allowed columns ─────────────────────────────────────────────

test("query: selects only spec-allowed columns", () => {
  const source = readSource(LEDGER_PATH);
  // Must select specific columns, not "*"
  assert.ok(
    source.includes("trace_id, created_at, deal_id, bank_id, env, event_key, payload"),
    "Must select exactly the allowed columns",
  );
  // Must NOT select "*"
  const selectStar = (source.match(/\.select\("\*"\)/g) || []).length;
  assert.equal(selectStar, 0, "Must NOT use select('*') — only allowed columns");
});

// ─── No PII exposure ────────────────────────────────────────────────────────

test("safety: does not reference PII fields", () => {
  const source = readSource(LEDGER_PATH);
  const piiFields = ["ssn", "email", "phone", "address", "borrower_name", "ocr_text"];
  for (const field of piiFields) {
    assert.ok(
      !source.includes(`"${field}"`),
      `Must not reference PII field: ${field}`,
    );
  }
});
