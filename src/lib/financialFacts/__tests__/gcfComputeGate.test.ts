import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  canRunGcfRecompute,
  ORPHANED_BY_FAILED_ORCHESTRATION,
} from "@/lib/financialFacts/gcfComputeGate";

/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1 — GCF orphan UI-recovery gate.
 *
 * The recompute POST runs the deterministic prerequisite repair BEFORE the gate,
 * but the page reads canonical state on a plain GET (no repair) — so a fully
 * repairable deal still loads computeBlocked. If Retry is disabled purely on
 * computeBlocked, an ORPHANED_BY_FAILED_ORCHESTRATION row is a permanent dead-end.
 */

test("orphaned GCF row keeps the only recovery action runnable even while computeBlocked", () => {
  assert.equal(
    canRunGcfRecompute({
      recomputing: false,
      isComputing: false,
      computeBlocked: true,
      isOrphanedRow: true,
    }),
    true,
  );
});

test("a non-orphan blocked row stays gated (steer banker upstream)", () => {
  assert.equal(
    canRunGcfRecompute({
      recomputing: false,
      isComputing: false,
      computeBlocked: true,
      isOrphanedRow: false,
    }),
    false,
  );
});

test("a ready / unblocked row can run", () => {
  assert.equal(
    canRunGcfRecompute({
      recomputing: false,
      isComputing: false,
      computeBlocked: false,
      isOrphanedRow: false,
    }),
    true,
  );
});

test("never offers the action while a compute is already in flight", () => {
  for (const inFlight of [{ recomputing: true }, { isComputing: true }]) {
    assert.equal(
      canRunGcfRecompute({
        recomputing: false,
        isComputing: false,
        computeBlocked: false,
        isOrphanedRow: true,
        ...inFlight,
      }),
      false,
      `in-flight (${JSON.stringify(inFlight)}) must not offer a duplicate compute`,
    );
  }
});

// ── Wiring guard: the GCF page uses the gate so the orphan path is not re-disabled ──

test("GCF page wires the orphan-aware gate into the Retry action", () => {
  const src = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx",
    ),
    "utf8",
  );
  assert.ok(/canRunGcfRecompute/.test(src), "page imports/uses the pure recovery gate");
  assert.ok(
    new RegExp(ORPHANED_BY_FAILED_ORCHESTRATION).test(src),
    "page detects the orphan error_code",
  );
  // The error-view Retry button is gated by the orphan-aware helper result
  // (canRetryError), NOT a bare computeBlocked, so an orphan stays recoverable.
  assert.ok(/canRetryError\s*=\s*canRunGcfRecompute\(/.test(src), "computes orphan-aware retry gate");
  assert.ok(/disabled=\{!canRetryError\}/.test(src), "Retry disabled is driven by the gate");
});
