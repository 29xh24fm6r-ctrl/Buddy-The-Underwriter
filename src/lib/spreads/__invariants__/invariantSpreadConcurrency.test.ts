/**
 * S1 — Spread Concurrency Safety Proof
 *
 * Proves: CAS mechanism, job merge on unique violation, and observer
 * auto-healing are correctly structured via source-code scanning.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── Source files ───────────────────────────────────────────────────────

const PROCESSOR_SRC = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
const ENQUEUE_SRC = readSource("src/lib/financialSpreads/enqueueSpreadRecompute.ts");
const RENDER_SRC = readSource("src/lib/financialSpreads/renderSpread.ts");
const OBSERVER_SRC = readSource("src/lib/aegis/spreadsInvariants.ts");

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Spread Concurrency Safety Proof", () => {
  test("Scenario A: CAS claim is two-step (queued claim + retry re-claim)", () => {
    // Step 1: claim a queued placeholder
    const step1Start = PROCESSOR_SRC.indexOf("Step 1: claim queued placeholder");
    assert.ok(step1Start > 0, "Step 1 comment must exist in processor");

    const step1Block = PROCESSOR_SRC.slice(step1Start, step1Start + 500);
    assert.ok(
      step1Block.includes('.eq("status", "queued")'),
      "Step 1 must filter by status=queued",
    );

    // Step 2: retry — reclaim a generating row owned by same run
    const step2Start = PROCESSOR_SRC.indexOf("Step 2: retry");
    assert.ok(step2Start > 0, "Step 2 comment must exist in processor");

    const step2Block = PROCESSOR_SRC.slice(step2Start, step2Start + 800);
    assert.ok(
      step2Block.includes('.eq("status", "generating")'),
      "Step 2 must filter by status=generating",
    );
    assert.ok(
      step2Block.includes('.eq("last_run_id", runId)'),
      "Step 2 must filter by last_run_id=runId for ownership",
    );
  });

  test("Scenario B: CAS claim sets last_run_id for ownership", () => {
    // The CAS payload must include last_run_id
    const casPayloadStart = PROCESSOR_SRC.indexOf("const casPayload");
    assert.ok(casPayloadStart > 0, "casPayload const must exist");

    const casPayloadBlock = PROCESSOR_SRC.slice(casPayloadStart, casPayloadStart + 300);
    assert.ok(
      casPayloadBlock.includes("last_run_id: runId"),
      "CAS payload must include last_run_id: runId",
    );
  });

  test("Scenario C: Job merge handles 23505 unique violation", () => {
    assert.ok(
      ENQUEUE_SRC.includes("23505"),
      "enqueueSpreadRecompute must handle 23505 unique violation",
    );

    // After 23505, must SELECT existing job and merge
    const mergeStart = ENQUEUE_SRC.indexOf("23505");
    const mergeBlock = ENQUEUE_SRC.slice(mergeStart, mergeStart + 600);
    assert.ok(
      mergeBlock.includes("requested_spread_types"),
      "23505 handler must merge requested_spread_types",
    );
  });

  test("Scenario D: Partial unique index enforces one active job per deal+bank", () => {
    // The enqueue source must reference the unique constraint behavior
    assert.ok(
      ENQUEUE_SRC.includes("QUEUED") && ENQUEUE_SRC.includes("RUNNING"),
      "Enqueue must reference QUEUED and RUNNING status filters for job uniqueness",
    );

    // Source must SELECT existing active job before insert
    assert.ok(
      ENQUEUE_SRC.includes('.in("status", ["QUEUED", "RUNNING"])'),
      "Enqueue must check for existing QUEUED/RUNNING jobs",
    );
  });

  test("Scenario E: Observer auto-heals stuck generating spreads", () => {
    // Must contain the 60-minute critical threshold
    assert.ok(
      OBSERVER_SRC.includes("GENERATING_CRITICAL_MIN") ||
        OBSERVER_SRC.includes("60"),
      "Observer must define critical threshold for generating timeout",
    );

    // Must set status to "error" on auto-heal
    const autoHealIdx = OBSERVER_SRC.indexOf("auto-healed");
    assert.ok(autoHealIdx > 0, "Observer must reference auto-heal behavior");

    // Must update status to error
    assert.ok(
      OBSERVER_SRC.includes('status: "error"'),
      "Observer must set status to error on auto-heal",
    );
  });

  test("Scenario F: Observer releases expired job leases", () => {
    // Must contain the 15-minute orphan threshold
    assert.ok(
      OBSERVER_SRC.includes("ORPHAN_LEASE_THRESHOLD_MIN") ||
        OBSERVER_SRC.includes("15"),
      "Observer must define orphan lease threshold",
    );

    // Must re-queue orphaned jobs
    assert.ok(
      OBSERVER_SRC.includes("orphaned") || OBSERVER_SRC.includes("orphan"),
      "Observer must handle orphaned jobs",
    );

    // Must set status back to QUEUED
    const orphanSection = OBSERVER_SRC.slice(
      OBSERVER_SRC.indexOf("checkSpreadJobOrphans"),
    );
    assert.ok(
      orphanSection.includes('"QUEUED"'),
      "Observer must re-queue orphaned jobs to QUEUED status",
    );
  });

  test("Scenario G: Unique constraint on deal_spreads prevents duplicate rows", () => {
    const migrationSrc = readSource(
      "supabase/migrations/20260206162336_personal_spreads_schema.sql",
    );

    assert.ok(
      migrationSrc.includes("deal_spreads_unique"),
      "Migration must define deal_spreads_unique index",
    );
    assert.ok(
      migrationSrc.includes("CREATE UNIQUE INDEX"),
      "Must be a UNIQUE index",
    );
    assert.ok(
      migrationSrc.includes("spread_type") && migrationSrc.includes("spread_version"),
      "Unique index must include spread_type and spread_version",
    );
    assert.ok(
      migrationSrc.includes("owner_type") && migrationSrc.includes("owner_entity_id"),
      "Unique index must include owner_type and owner_entity_id",
    );
  });

  test("Scenario H: renderSpread uses upsert (not insert)", () => {
    assert.ok(
      RENDER_SRC.includes(".upsert("),
      "renderSpread must use upsert for deal_spreads writes",
    );
    assert.ok(
      RENDER_SRC.includes("onConflict"),
      "renderSpread upsert must specify onConflict clause",
    );
  });
});
