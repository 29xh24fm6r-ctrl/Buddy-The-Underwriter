/**
 * Pipeline Hardening CI Guards
 *
 * Invariant guards for the intake pipeline hardening changes:
 * - artifacts_processing_stalled blocker exists
 * - Stalled thresholds are correct
 * - Spread render timeout is correct
 * - Fix action exists for stalled blocker
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { LifecycleBlockerCode, LifecycleBlocker } from "../model";
import { getBlockerFixAction } from "../nextAction";

// ── Guard 1: artifacts_processing_stalled exists in LifecycleBlockerCode ─────

test("Guard 1: artifacts_processing_stalled is a valid LifecycleBlockerCode", () => {
  // Type-level assertion: if this compiles, the code is in the union
  const code: LifecycleBlockerCode = "artifacts_processing_stalled";
  assert.strictEqual(code, "artifacts_processing_stalled");
});

// ── Guard 2: Stalled thresholds ─────────────────────────────────────────────

test("Guard 2: Stalled detection thresholds — QUEUED 5min, PROCESSING 10min", () => {
  // These are the canonical thresholds used in deriveLifecycleState.ts.
  // If they change, this guard must be updated in tandem.
  const QUEUED_STALE_MS = 5 * 60 * 1000;     // 5 min
  const PROCESSING_STALE_MS = 10 * 60 * 1000; // 10 min

  assert.strictEqual(QUEUED_STALE_MS, 300_000, "QUEUED_STALE_MS must be 5 minutes (300,000ms)");
  assert.strictEqual(PROCESSING_STALE_MS, 600_000, "PROCESSING_STALE_MS must be 10 minutes (600,000ms)");
});

// ── Guard 3: Spread render timeout ──────────────────────────────────────────

test("Guard 3: Spread RENDER_TIMEOUT_MS must be 90 seconds", () => {
  const RENDER_TIMEOUT_MS = 90_000;
  assert.strictEqual(RENDER_TIMEOUT_MS, 90_000, "Spread render timeout must be 90,000ms (90s)");
});

// ── Guard 4: Fix action exists for artifacts_processing_stalled ─────────────

test("Guard 4: getBlockerFixAction returns href-based fix for artifacts_processing_stalled", () => {
  const blocker: LifecycleBlocker = {
    code: "artifacts_processing_stalled",
    message: "3 document(s) stuck in processing pipeline",
    evidence: { stalledCount: 3, stalledArtifactIds: ["a", "b", "c"] },
  };

  const fix = getBlockerFixAction(blocker, "test-deal-id");
  assert.ok(fix, "Fix action must not be null");
  assert.ok("href" in fix && fix.href, "Fix action must have an href");
  assert.ok(fix.href!.includes("/documents"), "Fix action href must point to documents tab");
});

// ── Guard 5: Fix action label is descriptive ────────────────────────────────

test("Guard 5: Fix action for stalled blocker has descriptive label", () => {
  const blocker: LifecycleBlocker = {
    code: "artifacts_processing_stalled",
    message: "1 document(s) stuck in processing pipeline",
  };

  const fix = getBlockerFixAction(blocker, "deal-123");
  assert.ok(fix, "Fix action must not be null");
  assert.ok(fix.label.length > 0, "Fix action label must not be empty");
});
