/**
 * CI Guard — Intake Confirm Recovery Invariants
 *
 * Guards for FIX 1A (quality_status + finalized_at on confirm) and
 * FIX 2A (actionable auto-recovery for queued_never_started).
 *
 * Mix of source-string guards (for route behavior) and behavioral tests
 * (for pure functions).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { detectStuckProcessing } from "../detectStuckProcessing";
import { MAX_QUEUE_TO_START_MS } from "@/lib/intake/constants";

const ROOT = join(__dirname, "../../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1A Guards — Single doc confirm stamps quality_status + finalized_at
// ═══════════════════════════════════════════════════════════════════════════

describe("FIX 1A: Single doc confirm stamps quality + finalized", () => {
  const docConfirmSrc = readSource(
    "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
  );

  test("[fix1a-1] single doc confirm sets quality_status to PASSED", () => {
    assert.ok(
      docConfirmSrc.includes('quality_status: "PASSED"'),
      "Single doc confirm route must set quality_status to PASSED in the patch",
    );
  });

  test("[fix1a-2] single doc confirm sets finalized_at", () => {
    assert.ok(
      docConfirmSrc.includes("finalized_at:"),
      "Single doc confirm route must set finalized_at in the patch",
    );
  });

  test("[fix1a-3] single doc confirm emits intake.document_finalized event", () => {
    assert.ok(
      docConfirmSrc.includes('"intake.document_finalized"'),
      "Single doc confirm route must emit intake.document_finalized event",
    );
  });

  test("[fix1a-4] finalized event includes document_id and quality_status", () => {
    // The event meta should include the doc id and quality status for traceability
    assert.ok(
      docConfirmSrc.includes("document_id: documentId"),
      "intake.document_finalized event must include document_id",
    );
    assert.ok(
      docConfirmSrc.includes('quality_status: "PASSED"'),
      "intake.document_finalized event must include quality_status",
    );
  });

  test("[fix1a-5] quality_status is set BEFORE the update call", () => {
    // Verify quality_status appears in the patch object before .update()
    const patchIdx = docConfirmSrc.indexOf("const patch:");
    const updateIdx = docConfirmSrc.indexOf(".update(patch)");
    const qualityIdx = docConfirmSrc.indexOf('quality_status: "PASSED"');
    assert.ok(patchIdx > 0, "patch object must exist");
    assert.ok(updateIdx > 0, ".update(patch) call must exist");
    assert.ok(qualityIdx > 0, 'quality_status: "PASSED" must exist');
    assert.ok(
      qualityIdx < updateIdx,
      "quality_status must be set in patch BEFORE the .update() call",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2A Guards — Actionable auto-recovery
// ═══════════════════════════════════════════════════════════════════════════

describe("FIX 2A: Actionable auto-recovery", () => {
  test("[fix2a-1] handleStuckRecovery module exists", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(src.length > 0, "handleStuckRecovery.ts must exist and have content");
  });

  test("[fix2a-2] handleStuckRecovery distinguishes queued_never_started from other reasons", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(
      src.includes('"queued_never_started"'),
      "handleStuckRecovery must check for queued_never_started",
    );
    assert.ok(
      src.includes("reenqueueProcessing"),
      "handleStuckRecovery must have a re-enqueue path for queued_never_started",
    );
  });

  test("[fix2a-3] handleStuckRecovery re-enqueue generates new run_id", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(
      src.includes("crypto.randomUUID()"),
      "Re-enqueue path must generate a new run_id",
    );
  });

  test("[fix2a-4] handleStuckRecovery re-enqueue uses CAS guard", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(
      src.includes("updateDealIfRunOwner"),
      "Re-enqueue path must use CAS (updateDealIfRunOwner) to prevent clobbering",
    );
  });

  test("[fix2a-5] handleStuckRecovery emits intake.processing_auto_reenqueued", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(
      src.includes('"intake.processing_auto_reenqueued"'),
      "Re-enqueue path must emit intake.processing_auto_reenqueued event",
    );
  });

  test("[fix2a-6] handleStuckRecovery fail-closed on handoff failure", () => {
    const src = readSource("src/lib/intake/processing/handleStuckRecovery.ts");
    assert.ok(
      src.includes('"intake.processing_reenqueue_handoff_failed"'),
      "Re-enqueue path must emit failure event if handoff fails",
    );
    assert.ok(
      src.includes("PROCESSING_COMPLETE_WITH_ERRORS"),
      "Re-enqueue path must transition to error if handoff fails",
    );
  });

  test("[fix2a-7] review route uses handleStuckRecovery", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/review/route.ts",
    );
    assert.ok(
      src.includes("handleStuckRecovery"),
      "Review route must use shared handleStuckRecovery handler",
    );
    assert.ok(
      !src.includes('"intake.processing_auto_recovery"'),
      "Review route must NOT have inline auto_recovery event — delegated to handleStuckRecovery",
    );
  });

  test("[fix2a-8] processing-status route uses handleStuckRecovery", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/processing-status/route.ts",
    );
    assert.ok(
      src.includes("handleStuckRecovery"),
      "Processing-status route must use shared handleStuckRecovery handler",
    );
    assert.ok(
      !src.includes('"intake.processing_auto_recovery"'),
      "Processing-status route must NOT have inline auto_recovery event — delegated to handleStuckRecovery",
    );
  });

  test("[fix2a-9] review and processing-status routes expose reenqueued in response", () => {
    const reviewSrc = readSource(
      "src/app/api/deals/[dealId]/intake/review/route.ts",
    );
    const statusSrc = readSource(
      "src/app/api/deals/[dealId]/intake/processing-status/route.ts",
    );
    assert.ok(
      reviewSrc.includes("reenqueued"),
      "Review route response must include reenqueued field",
    );
    assert.ok(
      statusSrc.includes("reenqueued"),
      "Processing-status route response must include reenqueued field",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Behavioral Guards — detectStuckProcessing for queued_never_started
// ═══════════════════════════════════════════════════════════════════════════

describe("Behavioral: detectStuckProcessing queued_never_started", () => {
  const now = Date.now();

  test("[detect-1] queued_never_started fires when queued > MAX_QUEUE_TO_START_MS and no started_at", () => {
    const queuedAt = new Date(now - MAX_QUEUE_TO_START_MS - 1000).toISOString();
    const verdict = detectStuckProcessing(
      {
        intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
        intake_processing_queued_at: queuedAt,
        intake_processing_started_at: null,
        intake_processing_last_heartbeat_at: null,
        intake_processing_run_id: "run-123",
      },
      now,
    );
    assert.ok(verdict.stuck, "Should be stuck");
    assert.equal(verdict.stuck && verdict.reason, "queued_never_started");
  });

  test("[detect-2] NOT stuck when queued < MAX_QUEUE_TO_START_MS", () => {
    const queuedAt = new Date(now - 30_000).toISOString(); // 30 seconds ago
    const verdict = detectStuckProcessing(
      {
        intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
        intake_processing_queued_at: queuedAt,
        intake_processing_started_at: null,
        intake_processing_last_heartbeat_at: null,
        intake_processing_run_id: "run-123",
      },
      now,
    );
    assert.ok(!verdict.stuck, "Should NOT be stuck — just queued recently");
  });

  test("[detect-3] NOT stuck when started_at is set (even if old)", () => {
    const queuedAt = new Date(now - MAX_QUEUE_TO_START_MS - 60_000).toISOString();
    const startedAt = new Date(now - 60_000).toISOString();
    const heartbeat = new Date(now - 10_000).toISOString();
    const verdict = detectStuckProcessing(
      {
        intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
        intake_processing_queued_at: queuedAt,
        intake_processing_started_at: startedAt,
        intake_processing_last_heartbeat_at: heartbeat,
        intake_processing_run_id: "run-123",
      },
      now,
    );
    // Not queued_never_started — processing started
    if (verdict.stuck) {
      assert.notEqual(verdict.reason, "queued_never_started");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2B Guards — Confirm step enqueue integrity
// ═══════════════════════════════════════════════════════════════════════════

describe("FIX 2B: Confirm step enqueue integrity", () => {
  const confirmSrc = readSource(
    "src/app/api/deals/[dealId]/intake/confirm/route.ts",
  );

  test("[fix2b-1] confirm route stamps run_id + queued_at atomically", () => {
    assert.ok(
      confirmSrc.includes("intake_processing_queued_at:"),
      "Confirm route must stamp intake_processing_queued_at",
    );
    assert.ok(
      confirmSrc.includes("intake_processing_run_id:"),
      "Confirm route must stamp intake_processing_run_id",
    );
  });

  test("[fix2b-2] confirm route generates run_id before phase transition", () => {
    const runIdIdx = confirmSrc.indexOf("const runId = crypto.randomUUID()");
    const phaseUpdateIdx = confirmSrc.indexOf('intake_phase: "CONFIRMED_READY_FOR_PROCESSING"');
    assert.ok(runIdIdx > 0, "confirm route must generate runId");
    assert.ok(phaseUpdateIdx > 0, "confirm route must transition phase");
    assert.ok(
      runIdIdx < phaseUpdateIdx,
      "runId must be generated BEFORE phase transition",
    );
  });

  test("[fix2b-3] confirm route fail-closed on WORKER_SECRET missing", () => {
    assert.ok(
      confirmSrc.includes("WORKER_SECRET"),
      "Confirm route must check WORKER_SECRET",
    );
    assert.ok(
      confirmSrc.includes("handoff_misconfigured"),
      "Confirm route must fail-close if WORKER_SECRET missing",
    );
  });

  test("[fix2b-4] confirm route fail-closed on handoff failure", () => {
    assert.ok(
      confirmSrc.includes("processing_handoff_failed"),
      "Confirm route must emit handoff_failed event if process route invocation fails",
    );
    assert.ok(
      confirmSrc.includes("PROCESSING_COMPLETE_WITH_ERRORS"),
      "Confirm route must transition to error on handoff failure",
    );
  });
});
