/**
 * STUCK-SPREADS Batch 1 — Source-inspection invariants (2026-04-23)
 *
 * Proves:
 *   1. orchestrateSpreads wraps post-insert work in try/catch that marks
 *      the run row 'failed', reconciles orphan placeholders, emits an
 *      Aegis event, and re-throws (silent-crash guard).
 *   2. enqueueSpreadRecompute resolves the backing job BEFORE upserting
 *      placeholders (prevents orphan placeholders with no job).
 *   3. cleanupOrphanSpreads calls the find_orphan_spreads RPC and marks
 *      orphans 'error' with ORPHANED_BY_FAILED_ORCHESTRATION.
 *   4. Worker tick wires cleanupOrphanSpreads into the ALL branch.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("STUCK-SPREADS Batch 1 — invariants", () => {
  test("orchestrateSpreads: try/catch wraps post-insert work and re-throws", () => {
    const src = readSource("src/lib/spreads/orchestrateSpreads.ts");

    assert.ok(
      src.includes("SPREAD_ORCHESTRATION_FAILED"),
      "must emit Aegis error_code SPREAD_ORCHESTRATION_FAILED on catch",
    );
    assert.ok(
      src.includes('status: "failed"') && src.includes('finished_at: new Date().toISOString()'),
      "must mark deal_spread_runs as failed with finished_at on catch",
    );
    assert.ok(
      src.includes('ORCHESTRATION_FAILED') && src.includes('status: "error"'),
      "must reconcile orphan deal_spreads to status=error with ORCHESTRATION_FAILED",
    );
    assert.ok(
      src.includes("throw orchErr"),
      "must re-throw the original error after cleanup",
    );
    assert.ok(
      src.includes('spreads_orchestrator'),
      "Aegis event must use source_system=spreads_orchestrator",
    );
  });

  test("enqueueSpreadRecompute: job resolution precedes placeholder upsert", () => {
    const src = readSource("src/lib/financialSpreads/enqueueSpreadRecompute.ts");

    const jobLookupIdx = src.indexOf('.from("deal_spread_jobs")');
    const placeholderUpsertIdx = src.indexOf('.from("deal_spreads")');

    assert.ok(jobLookupIdx > 0, "must query deal_spread_jobs");
    assert.ok(placeholderUpsertIdx > 0, "must upsert deal_spreads placeholder");
    assert.ok(
      jobLookupIdx < placeholderUpsertIdx,
      "deal_spread_jobs resolution must come BEFORE deal_spreads placeholder upsert (STUCK-SPREADS fix)",
    );
    // Guard against the old ordering where placeholders were upserted inside
    // the first try{} block near the top (before job resolution).
    const firstPlaceholderBlock = src.slice(0, jobLookupIdx);
    assert.ok(
      !firstPlaceholderBlock.includes('.from("deal_spreads")'),
      "must not upsert placeholders before job resolution",
    );
  });

  test("cleanupOrphanSpreads: module exists and calls find_orphan_spreads RPC", () => {
    const path = "src/lib/spreads/janitor/cleanupOrphanSpreads.ts";
    assert.ok(existsSync(resolve(ROOT, path)), `${path} must exist`);

    const src = readSource(path);
    assert.ok(
      src.includes('rpc("find_orphan_spreads"'),
      "must call find_orphan_spreads RPC",
    );
    assert.ok(
      src.includes("ORPHANED_BY_FAILED_ORCHESTRATION"),
      "must mark cleaned rows with ORPHANED_BY_FAILED_ORCHESTRATION",
    );
    assert.ok(
      src.includes('status: "error"'),
      "must set status=error on orphan rows",
    );
    assert.ok(
      src.includes("spreads_janitor"),
      "must emit Aegis event with source_system=spreads_janitor",
    );
  });

  test("worker tick: cleanupOrphanSpreads wired into ALL branch", () => {
    const src = readSource("src/app/api/jobs/worker/tick/route.ts");
    assert.ok(
      src.includes("cleanupOrphanSpreads"),
      "worker tick must import and invoke cleanupOrphanSpreads",
    );
    assert.ok(
      src.includes('import { cleanupOrphanSpreads }'),
      "worker tick must import from spreads/janitor/cleanupOrphanSpreads",
    );
  });

  test("migration file: find_orphan_spreads SQL function committed to supabase/migrations", () => {
    const path = "supabase/migrations/20260423_find_orphan_spreads_function.sql";
    assert.ok(existsSync(resolve(ROOT, path)), `${path} must exist`);

    const sql = readSource(path);
    assert.ok(
      sql.includes("CREATE OR REPLACE FUNCTION find_orphan_spreads"),
      "must define find_orphan_spreads function",
    );
    assert.ok(
      sql.includes("status = 'queued'") && sql.includes("started_at IS NULL"),
      "function must filter on status='queued' AND started_at IS NULL",
    );
    assert.ok(
      sql.includes("NOT EXISTS") && sql.includes("deal_spread_jobs"),
      "function must exclude spreads that have a backing active job",
    );
  });
});
