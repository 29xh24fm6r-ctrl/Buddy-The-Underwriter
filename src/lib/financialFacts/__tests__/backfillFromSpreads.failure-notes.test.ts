/**
 * SPEC-FOUNDATION-V1 PR5e — Backfill failure notes preservation guard.
 *
 * Verifies that backfillFromSpreads's failure return includes per-write
 * notes, and that spreadsProcessor propagates them to both ledger events.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const BACKFILL_PATH = join(REPO_ROOT, "src/lib/financialFacts/backfillFromSpreads.ts");
const SP_PATH = join(REPO_ROOT, "src/lib/jobs/processors/spreadsProcessor.ts");

function readBackfill(): string {
  return readFileSync(BACKFILL_PATH, "utf8");
}
function readSP(): string {
  return readFileSync(SP_PATH, "utf8");
}

// ── Backfill return type guards ────────────────────────────────────────────

test("[pr5e-1] backfillFromSpreads failure return type includes notes", () => {
  const body = readBackfill();
  assert.match(
    body,
    /ok: false.*error: string.*notes\?.*string\[\]/s,
    "Failure variant of return type must include notes?: string[].",
  );
});

test("[pr5e-2] backfillFromSpreads all-failed return includes notes array", () => {
  const body = readBackfill();
  // The all-failed return must include notes. SPEC-CURRENT-STAGE-AUDIT-FIX-2 reworded the message
  // to "All ${failed} attempted fact writes failed" (period/null skips no longer counted as writes).
  const allFailedIdx = body.indexOf("attempted fact writes failed");
  assert.ok(allFailedIdx > 0, "All-failed return not found");
  const context = body.slice(allFailedIdx - 100, allFailedIdx + 200);
  assert.match(
    context,
    /notes/,
    "The all-failed return must include the notes array.",
  );
});

// ── spreadsProcessor propagation guards ────────────────────────────────────

test("[pr5e-3] facts.materialization.failed event includes notes on failure path", () => {
  const body = readSP();
  // Find the failure-path meta for facts.materialization.failed
  const failedIdx = body.indexOf("facts.materialization.failed");
  assert.ok(failedIdx > 0, "facts.materialization.failed not found");
  // The meta block for the failure path should include notes
  const surrounding = body.slice(failedIdx - 200, failedIdx + 500);
  // Look for the failure branch (the ternary's false side) including notes
  assert.match(
    surrounding,
    /notes:.*backfill.*\.notes/,
    "facts.materialization.failed event's failure-path meta must include notes from backfill.",
  );
});

test("[pr5e-4] canonical.recompute.backfill.completed event includes notes on failure path", () => {
  const body = readSP();
  const canonIdx = body.indexOf("canonical.recompute.backfill.completed");
  assert.ok(canonIdx > 0, "canonical.recompute.backfill.completed not found");
  const context = body.slice(canonIdx, canonIdx + 800);
  // Both success and failure paths should include notes (not just [])
  assert.match(
    context,
    /backfill.*\.notes\s*\?\?\s*\[\]/s,
    "canonical.recompute.backfill.completed's failure path must propagate backfill.notes (with ?? [] fallback).",
  );
});

// ── Notes content guard ────────────────────────────────────────────────────

test("[pr5e-5] backfillFromSpreads pushes fact_upsert_failed entries into notes", () => {
  const body = readBackfill();
  assert.match(
    body,
    /fact_upsert_failed/,
    "backfillFromSpreads must push 'fact_upsert_failed:*' entries for each failed upsert.",
  );
});
