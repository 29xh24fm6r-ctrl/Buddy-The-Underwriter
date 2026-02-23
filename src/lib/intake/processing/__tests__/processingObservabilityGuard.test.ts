/**
 * CI Guard — Processing Observability Invariants
 *
 * Guards for the intake processing observability system:
 * - Constant ordering (queue < heartbeat < overall)
 * - detectStuckProcessing pure-function correctness
 * - Version constants CI-locked
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_QUEUE_TO_START_MS,
  MAX_HEARTBEAT_STALE_MS,
  MAX_PROCESSING_WINDOW_MS,
  PROCESSING_OBSERVABILITY_VERSION,
} from "@/lib/intake/constants";

import {
  detectStuckProcessing,
  STUCK_DETECTION_VERSION,
} from "@/lib/intake/processing/detectStuckProcessing";

import type { ProcessingRunMarkers } from "@/lib/intake/processing/detectStuckProcessing";

describe("Processing Observability CI Guards", () => {
  // ── Guard 1: Constant ordering ─────────────────────────────────────
  test("[guard-1] MAX_QUEUE_TO_START_MS < MAX_HEARTBEAT_STALE_MS < MAX_PROCESSING_WINDOW_MS", () => {
    assert.ok(
      MAX_QUEUE_TO_START_MS < MAX_HEARTBEAT_STALE_MS,
      `queue ${MAX_QUEUE_TO_START_MS} must be < heartbeat ${MAX_HEARTBEAT_STALE_MS}`,
    );
    assert.ok(
      MAX_HEARTBEAT_STALE_MS < MAX_PROCESSING_WINDOW_MS,
      `heartbeat ${MAX_HEARTBEAT_STALE_MS} must be < overall ${MAX_PROCESSING_WINDOW_MS}`,
    );
  });

  // ── Guard 2: Non-CONFIRMED phases → not stuck ──────────────────────
  test("[guard-2] detectStuckProcessing returns stuck:false for non-CONFIRMED phases", () => {
    const phases = [
      "BULK_UPLOADED",
      "CLASSIFIED_PENDING_CONFIRMATION",
      "PROCESSING_COMPLETE",
      "PROCESSING_COMPLETE_WITH_ERRORS",
      null,
    ];
    for (const phase of phases) {
      const markers: ProcessingRunMarkers = {
        intake_phase: phase,
        intake_processing_queued_at: new Date().toISOString(),
        intake_processing_started_at: null,
        intake_processing_last_heartbeat_at: null,
        intake_processing_run_id: "test-run-id",
      };
      const verdict = detectStuckProcessing(markers, Date.now());
      assert.equal(verdict.stuck, false, `phase=${phase} should not be stuck`);
    }
  });

  // ── Guard 3: queued_never_started detection ────────────────────────
  test("[guard-3] detectStuckProcessing returns queued_never_started when queue age exceeds threshold", () => {
    const now = Date.now();
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: new Date(now - MAX_QUEUE_TO_START_MS - 1000).toISOString(),
      intake_processing_started_at: null,
      intake_processing_last_heartbeat_at: null,
      intake_processing_run_id: "test-run-id",
    };
    const verdict = detectStuckProcessing(markers, now);
    assert.equal(verdict.stuck, true);
    assert.equal((verdict as any).reason, "queued_never_started");
  });

  // ── Guard 4: heartbeat_stale detection ─────────────────────────────
  test("[guard-4] detectStuckProcessing returns heartbeat_stale when beat age exceeds threshold", () => {
    const now = Date.now();
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: new Date(now - 60_000).toISOString(),
      intake_processing_started_at: new Date(now - 50_000).toISOString(),
      intake_processing_last_heartbeat_at: new Date(now - MAX_HEARTBEAT_STALE_MS - 1000).toISOString(),
      intake_processing_run_id: "test-run-id",
    };
    const verdict = detectStuckProcessing(markers, now);
    assert.equal(verdict.stuck, true);
    assert.equal((verdict as any).reason, "heartbeat_stale");
  });

  // ── Guard 5: Version constants CI-locked ───────────────────────────
  test("[guard-5] PROCESSING_OBSERVABILITY_VERSION and STUCK_DETECTION_VERSION are CI-locked", () => {
    assert.equal(PROCESSING_OBSERVABILITY_VERSION, "observability_v1");
    assert.equal(STUCK_DETECTION_VERSION, "stuck_v1");
  });

  // ── Guard 6: legacy_no_markers detection ───────────────────────────
  test("[guard-6] detectStuckProcessing returns legacy_no_markers when queued_at is null", () => {
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: null,
      intake_processing_started_at: null,
      intake_processing_last_heartbeat_at: null,
      intake_processing_run_id: null,
    };
    const verdict = detectStuckProcessing(markers, Date.now());
    assert.equal(verdict.stuck, true);
    assert.equal((verdict as any).reason, "legacy_no_markers");
  });

  // ── Guard 7: overall_timeout detection ─────────────────────────────
  test("[guard-7] detectStuckProcessing returns overall_timeout when total elapsed exceeds window", () => {
    const now = Date.now();
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: new Date(now - MAX_PROCESSING_WINDOW_MS - 1000).toISOString(),
      intake_processing_started_at: new Date(now - MAX_PROCESSING_WINDOW_MS - 500).toISOString(),
      // Heartbeat is recent enough to not trigger heartbeat_stale
      intake_processing_last_heartbeat_at: new Date(now - 10_000).toISOString(),
      intake_processing_run_id: "test-run-id",
    };
    const verdict = detectStuckProcessing(markers, now);
    assert.equal(verdict.stuck, true);
    assert.equal((verdict as any).reason, "overall_timeout");
  });

  // ── Guard 8: Happy path — recent heartbeat, not stuck ──────────────
  test("[guard-8] detectStuckProcessing returns stuck:false for actively progressing run", () => {
    const now = Date.now();
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: new Date(now - 30_000).toISOString(),
      intake_processing_started_at: new Date(now - 25_000).toISOString(),
      intake_processing_last_heartbeat_at: new Date(now - 5_000).toISOString(),
      intake_processing_run_id: "test-run-id",
    };
    const verdict = detectStuckProcessing(markers, now);
    assert.equal(verdict.stuck, false);
  });

  // ── Guard 9: Legacy time guard — confirmedSinceMs prevents false positives ──
  test("[guard-9] detectStuckProcessing with confirmedSinceMs returns stuck:false when recently confirmed (legacy)", () => {
    const now = Date.now();
    // Legacy deal: no queued_at, but just confirmed 30s ago
    const markers: ProcessingRunMarkers = {
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      intake_processing_queued_at: null,
      intake_processing_started_at: null,
      intake_processing_last_heartbeat_at: null,
      intake_processing_run_id: null,
    };
    // Recently confirmed — should NOT trigger legacy detection
    const verdict = detectStuckProcessing(markers, now, now - 30_000);
    assert.equal(verdict.stuck, false, "Recently confirmed legacy deal must not be stuck");

    // Same deal, but confirmed > MAX_QUEUE_TO_START_MS ago — should trigger
    const oldVerdict = detectStuckProcessing(markers, now, now - MAX_QUEUE_TO_START_MS - 1000);
    assert.equal(oldVerdict.stuck, true, "Old legacy deal must be stuck");
    assert.equal((oldVerdict as any).reason, "legacy_no_markers");
  });
});
