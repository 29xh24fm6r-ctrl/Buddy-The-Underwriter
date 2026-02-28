/**
 * CI Guard — Process Route Durability Invariants
 *
 * Ensures the intake processing architecture remains durable:
 * - Dedicated process route has maxDuration >= 300
 * - Confirm route does NOT directly import processConfirmedIntake
 * - Confirm route invokes /intake/process via fetch (self-invocation)
 * - Threshold ordering invariant holds with raised values
 * - Soft deadline guard is present in process route
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_QUEUE_TO_START_MS,
  MAX_HEARTBEAT_STALE_MS,
  MAX_PROCESSING_WINDOW_MS,
} from "@/lib/intake/constants";

const ROOT = join(__dirname, "../../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

describe("Process Route Durability CI Guards", () => {
  // ── Guard 1: maxDuration on process route ─────────────────────────
  test("[guard-1] process route exports maxDuration >= 300", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/process/route.ts",
    );
    const match = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    assert.ok(match, "process route must export maxDuration");
    const value = parseInt(match![1], 10);
    assert.ok(
      value >= 300,
      `maxDuration must be >= 300 (got ${value})`,
    );
  });

  // ── Guard 2: Confirm route does NOT import processConfirmedIntake ──
  test("[guard-2] confirm route does not directly import processConfirmedIntake", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );
    assert.ok(
      !src.includes("processConfirmedIntake"),
      "confirm route must NOT directly import processConfirmedIntake — processing is decoupled via /intake/process",
    );
  });

  // ── Guard 3: Confirm route uses durable outbox (not HTTP self-invocation) ──
  test("[guard-3] confirm route enqueues via finalize RPC (no HTTP self-invocation)", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );
    assert.ok(
      src.includes("finalize_intake_and_enqueue_processing"),
      "confirm route must use the atomic finalize RPC to enqueue processing",
    );
    // Confirm route must NOT import runIntakeProcessing or processConfirmedIntake
    const hasStaticRunImport = /^import\s+.*runIntakeProcessing.*from/m.test(src);
    assert.ok(
      !hasStaticRunImport,
      "confirm route must NOT import runIntakeProcessing — processing is decoupled via outbox",
    );
  });

  // ── Guard 4: Threshold ordering invariant ──────────────────────────
  test("[guard-4] threshold ordering: queue < heartbeat < overall", () => {
    assert.ok(
      MAX_QUEUE_TO_START_MS < MAX_HEARTBEAT_STALE_MS,
      `queue ${MAX_QUEUE_TO_START_MS} must be < heartbeat ${MAX_HEARTBEAT_STALE_MS}`,
    );
    assert.ok(
      MAX_HEARTBEAT_STALE_MS < MAX_PROCESSING_WINDOW_MS,
      `heartbeat ${MAX_HEARTBEAT_STALE_MS} must be < overall ${MAX_PROCESSING_WINDOW_MS}`,
    );
  });

  // ── Guard 5: Raised thresholds are in expected ranges ──────────────
  test("[guard-5] thresholds are raised to accommodate large doc sets", () => {
    assert.ok(
      MAX_PROCESSING_WINDOW_MS >= 15 * 60 * 1000,
      `overall timeout must be >= 15 min (got ${MAX_PROCESSING_WINDOW_MS}ms)`,
    );
    assert.ok(
      MAX_HEARTBEAT_STALE_MS >= 5 * 60 * 1000,
      `heartbeat stale must be >= 5 min (got ${MAX_HEARTBEAT_STALE_MS}ms)`,
    );
    assert.ok(
      MAX_QUEUE_TO_START_MS >= 3 * 60 * 1000,
      `queue-to-start must be >= 3 min (got ${MAX_QUEUE_TO_START_MS}ms)`,
    );
  });

  // ── Guard 6: Soft deadline guard in runIntakeProcessing ──────────────
  test("[guard-6] runIntakeProcessing implements soft deadline guard", () => {
    const src = readSource(
      "src/lib/intake/processing/runIntakeProcessing.ts",
    );
    assert.ok(
      src.includes("SOFT_DEADLINE"),
      "runIntakeProcessing must implement a soft deadline guard",
    );
    assert.ok(
      src.includes("Promise.race"),
      "runIntakeProcessing must use Promise.race for deadline enforcement",
    );
    assert.ok(
      src.includes("updateDealIfRunOwner"),
      "runIntakeProcessing must guarantee phase transition via updateDealIfRunOwner",
    );
  });

  // ── Guard 7: Confirm route does NOT directly import enqueueDealProcessing ──
  test("[guard-7] confirm route does not statically import enqueueDealProcessing", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );
    // Allow dynamic import in fallback path, but no static top-level import
    const staticImportMatch = src.match(
      /^import\s+.*enqueueDealProcessing.*from/m,
    );
    assert.ok(
      !staticImportMatch,
      "confirm route must NOT have a static import of enqueueDealProcessing — processing is decoupled",
    );
  });

  // ── Guard 8a: invalidateIntakeSnapshot CAS guard ────────────────────
  test("[guard-8a] invalidateIntakeSnapshot uses CAS guard with intake_processing_run_id", () => {
    const src = readSource(
      "src/lib/intake/confirmation/invalidateIntakeSnapshot.ts",
    );
    assert.ok(
      src.includes('.is("intake_processing_run_id", null)'),
      "invalidateIntakeSnapshot must CAS-guard against active processing run",
    );
    assert.ok(
      src.includes('.eq("intake_phase", "CONFIRMED_READY_FOR_PROCESSING")'),
      "invalidateIntakeSnapshot must re-check phase in WHERE clause (CAS)",
    );
  });

  // ── Guard 8: Process route has proper auth ─────────────────────────
  test("[guard-8] process route checks authorization via requireRoleApi", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/process/route.ts",
    );
    assert.ok(
      src.includes("requireRoleApi"),
      "process route must check authorization via requireRoleApi",
    );
    assert.ok(
      src.includes("ensureDealBankAccess"),
      "process route must enforce tenant access via ensureDealBankAccess",
    );
  });
});
