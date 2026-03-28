import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * Phase 65E — executeCanonicalAction structural tests.
 *
 * These are CI-safe guards that verify the executor's structure
 * without requiring a live Supabase connection.
 */

// ── Test 1: Executor imports server-only ─────────────────────
test("executor is server-only", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(
    content.includes('import "server-only"'),
    "Must import server-only",
  );
});

// ── Test 2: Executor uses supabaseAdmin ──────────────────────
test("executor uses supabaseAdmin", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(content.includes("supabaseAdmin"), "Must use supabaseAdmin");
});

// ── Test 3: Executor records audit in canonical_action_executions ──
test("executor inserts into canonical_action_executions", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  const insertCount = (content.match(/canonical_action_executions/g) ?? []).length;
  assert.ok(insertCount >= 2, "Must insert into canonical_action_executions for both success and failure paths");
});

// ── Test 4: Executor emits ledger event ──────────────────────
test("executor emits ledger event", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(content.includes("logLedgerEvent"), "Must call logLedgerEvent");
  assert.ok(
    content.includes("canonical_action.executed"),
    "Must emit canonical_action.executed event key",
  );
});

// ── Test 5: Executor handles failure path ────────────────────
test("executor has failure path with error capture", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(content.includes("catch"), "Must have catch block");
  assert.ok(content.includes('"failed"'), "Must set failed status on error");
  assert.ok(content.includes("error_text"), "Must record error text");
});

// ── Test 6: Executor uses execution map ──────────────────────
test("executor uses CANONICAL_ACTION_EXECUTION_MAP", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("CANONICAL_ACTION_EXECUTION_MAP"),
    "Must use the canonical action execution map",
  );
});

// ── Test 7: Handler index routes to named handlers ───────────
test("handler index routes to specific handlers", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/handlers/index.ts"),
    "utf8",
  );
  assert.ok(content.includes("handleRequestDocuments"), "Must route request_documents");
  assert.ok(content.includes("handleSeedChecklist"), "Must route seed_checklist");
  assert.ok(content.includes("handleRunExtraction"), "Must route run_extraction");
  assert.ok(content.includes("handleGenerateFinancialSnapshot"), "Must route generate_financial_snapshot");
  assert.ok(content.includes("handleNoActionRequired"), "Must route no_action_required");
  assert.ok(content.includes("handleTaskOnly"), "Must have task-only fallback");
});

// ── Test 8: requestDocuments handler is idempotent ───────────
test("requestDocuments handler checks for existing open condition", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/handlers/requestDocuments.ts"),
    "utf8",
  );
  assert.ok(content.includes("already_exists"), "Must return already_exists for duplicates");
  assert.ok(content.includes("deal_conditions"), "Must write to deal_conditions");
  assert.ok(content.includes("canonical_request_documents"), "Must use canonical source_key");
});

// ── Test 9: seedChecklist handler is idempotent ──────────────
test("seedChecklist handler checks for existing seed", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/handlers/seedChecklist.ts"),
    "utf8",
  );
  assert.ok(content.includes("already_exists"), "Must return already_exists for duplicates");
  assert.ok(content.includes("deal_monitoring_seeds"), "Must write to deal_monitoring_seeds");
  assert.ok(content.includes("checklist_seed"), "Must use checklist_seed type");
});

// ── Test 10: noActionRequired handler returns noop ───────────
test("noActionRequired handler returns noop", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/handlers/noActionRequired.ts"),
    "utf8",
  );
  assert.ok(content.includes('"noop"'), "Must return noop status");
  assert.ok(content.includes("ok: true"), "Must return ok: true");
});
