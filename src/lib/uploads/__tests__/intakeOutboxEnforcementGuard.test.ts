/**
 * CI Source Guards — Phase E3 Durable Outbox Enforcement
 *
 * These are SOURCE GUARDS (string/regex) — not integration tests.
 * They read source files as strings and assert structural invariants
 * that prevent regression to HTTP-based intake orchestration.
 *
 * Enforced invariants:
 *  1. Confirm route does NOT use fetch()
 *  2. Confirm route does NOT use after()
 *  3. handleStuckRecovery does NOT use fetch()
 *  4. handleStuckRecovery does NOT use after()
 *  5. handleStuckRecovery uses insertOutboxEvent
 *  6. runIntakeProcessing uses updateDealIfRunOwner
 *  7. runIntakeProcessing uses enqueueDealProcessing
 *  8. Process route does NOT directly call enqueueDealProcessing
 *  9. Process route uses runIntakeProcessing
 * 10. Claim RPC uses FOR UPDATE SKIP LOCKED
 * 11. runIntakeProcessing throws on gate failure (processing_gated)
 * 12. Consumer verifies terminal phase (phase_not_terminal)
 * 13. Consumer pre-flight skips superseded run_id (skipped_superseded)
 * 14. All terminal transitions use computeDealPhasePatch
 * 15. Consumer failure path never sets delivered_at
 * 16. processing-status returns latest_outbox
 * 17. CHECK constraint migration includes all 5 phases
 * 18. Entity constraints hard-fail when entity is null (v1.4.0)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __esmDirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__esmDirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

/** Strip single-line comments from source (// ...) for non-comment assertions. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      // Remove // comments (but not inside strings — good enough for guard assertions)
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

const confirmSrc = readSource(
  "src/app/api/deals/[dealId]/intake/confirm/route.ts",
);
const confirmCode = stripComments(confirmSrc);

const recoverySrc = readSource(
  "src/lib/intake/processing/handleStuckRecovery.ts",
);
const recoveryCode = stripComments(recoverySrc);

const runProcessingSrc = readSource(
  "src/lib/intake/processing/runIntakeProcessing.ts",
);

const processRouteSrc = readSource(
  "src/app/api/deals/[dealId]/intake/process/route.ts",
);

const outboxConsumerSrc = readSource(
  "src/lib/workers/processIntakeOutbox.ts",
);

const processingStatusSrc = readSource(
  "src/app/api/deals/[dealId]/intake/processing-status/route.ts",
);

const constraintMigrationSrc = readSource(
  "supabase/migrations/20260427_fix_intake_phase_constraint.sql",
);

const phasePatchSrc = readSource(
  "src/lib/intake/processing/computeDealPhasePatch.ts",
);

const claimRpcSrc = readSource(
  "supabase/migrations/20260226_claim_intake_outbox_rpc.sql",
);

const constraintsSrc = readSource(
  "src/lib/intake/matching/constraints.ts",
);

describe("Phase E3 — Durable Outbox Enforcement Guards", () => {
  test("[guard-1] confirm route must NOT use fetch()", () => {
    assert.ok(
      !/\bfetch\s*\(/.test(confirmCode),
      "Confirm route must NOT call fetch() — processing triggered exclusively via outbox",
    );
  });

  test("[guard-2] confirm route must NOT use after()", () => {
    assert.ok(
      !/\bafter\s*\(/.test(confirmCode),
      "Confirm route must NOT call after() — no background work in confirm Lambda",
    );
  });

  test("[guard-3] handleStuckRecovery must NOT use fetch()", () => {
    assert.ok(
      !/\bfetch\s*\(/.test(recoveryCode),
      "handleStuckRecovery must NOT call fetch() — re-enqueue via outbox only",
    );
  });

  test("[guard-4] handleStuckRecovery must NOT use after()", () => {
    assert.ok(
      !/\bafter\s*\(/.test(recoveryCode),
      "handleStuckRecovery must NOT call after() — no background work",
    );
  });

  test("[guard-5] handleStuckRecovery must use insertOutboxEvent", () => {
    assert.ok(
      /insertOutboxEvent/.test(recoverySrc),
      "handleStuckRecovery must import and use insertOutboxEvent for re-enqueue",
    );
    assert.ok(
      /from\s+["']@\/lib\/outbox\/insertOutboxEvent["']/.test(recoverySrc),
      "handleStuckRecovery must import from @/lib/outbox/insertOutboxEvent",
    );
  });

  test("[guard-6] runIntakeProcessing must use updateDealIfRunOwner", () => {
    assert.ok(
      /updateDealIfRunOwner/.test(runProcessingSrc),
      "runIntakeProcessing must use updateDealIfRunOwner for CAS phase transitions",
    );
  });

  test("[guard-7] runIntakeProcessing must use enqueueDealProcessing", () => {
    assert.ok(
      /enqueueDealProcessing/.test(runProcessingSrc),
      "runIntakeProcessing must call enqueueDealProcessing for processing trigger",
    );
  });

  test("[guard-8] process route must NOT directly call enqueueDealProcessing", () => {
    assert.ok(
      !/enqueueDealProcessing/.test(processRouteSrc),
      "Process route must NOT import enqueueDealProcessing — delegates to runIntakeProcessing",
    );
  });

  test("[guard-9] process route must use runIntakeProcessing", () => {
    assert.ok(
      /runIntakeProcessing/.test(processRouteSrc),
      "Process route must call runIntakeProcessing",
    );
    assert.ok(
      /from\s+["']@\/lib\/intake\/processing\/runIntakeProcessing["']/.test(
        processRouteSrc,
      ),
      "Process route must import from @/lib/intake/processing/runIntakeProcessing",
    );
  });

  test("[guard-10] claim RPC must use FOR UPDATE SKIP LOCKED", () => {
    assert.ok(
      /FOR UPDATE SKIP LOCKED/.test(claimRpcSrc),
      "Claim RPC must use FOR UPDATE SKIP LOCKED for concurrent-safe batch claiming",
    );
  });

  test("[guard-11] runIntakeProcessing must throw on gate failure", () => {
    assert.ok(
      /processing_gated/.test(runProcessingSrc),
      "runIntakeProcessing must throw processing_gated when enqueueDealProcessing returns {ok: false}",
    );
  });

  test("[guard-12] consumer must verify terminal phase after processing", () => {
    assert.ok(
      /phase_not_terminal/.test(outboxConsumerSrc),
      "Consumer must throw phase_not_terminal if deal still in CONFIRMED_READY_FOR_PROCESSING after processing",
    );
  });

  test("[guard-13] consumer must pre-flight skip superseded run_id", () => {
    assert.ok(
      /skipped_superseded/.test(outboxConsumerSrc),
      "Consumer must skip outbox rows with superseded run_id (pre-flight stale check)",
    );
  });

  test("[guard-14] all terminal transitions must use computeDealPhasePatch", () => {
    // Every file that transitions to a terminal phase must import computeDealPhasePatch
    assert.ok(
      /computeDealPhasePatch/.test(runProcessingSrc),
      "runIntakeProcessing must use computeDealPhasePatch for terminal transitions",
    );
    assert.ok(
      /computeDealPhasePatch/.test(recoverySrc),
      "handleStuckRecovery must use computeDealPhasePatch for terminal transitions",
    );
    assert.ok(
      /computeDealPhasePatch/.test(phasePatchSrc),
      "computeDealPhasePatch module must exist and export the function",
    );
  });

  test("[guard-15] consumer failure path must NOT set delivered_at", () => {
    // Extract the catch block of the consumer processing loop.
    // The markFailed function must NOT set delivered_at.
    const markFailedMatch = outboxConsumerSrc.match(
      /async function markFailed[\s\S]*?^}/m,
    );
    assert.ok(markFailedMatch, "markFailed function must exist in consumer");
    assert.ok(
      !/delivered_at/.test(markFailedMatch![0]),
      "markFailed must NOT set delivered_at — only success/skip paths set it",
    );
  });

  test("[guard-16] processing-status must return latest_outbox", () => {
    assert.ok(
      /latest_outbox/.test(processingStatusSrc),
      "processing-status must return latest_outbox object in response",
    );
    assert.ok(
      /buddy_outbox_events/.test(processingStatusSrc),
      "processing-status must query buddy_outbox_events for outbox data",
    );
  });

  test("[guard-18] entity constraints must hard-fail when entity is null (v1.4.0)", () => {
    // v1.4.0: No soft-skip — entity=null + entity-required slot → satisfied=false
    assert.ok(
      /No entity resolved/.test(constraintsSrc),
      "checkEntityIdMatch must contain 'No entity resolved' for null-entity hard fail",
    );
    assert.ok(
      /No entity role resolved/.test(constraintsSrc),
      "checkEntityRoleMatch must contain 'No entity role resolved' for null-entity hard fail",
    );
    // Must NOT contain soft-skip artifacts
    assert.ok(
      !/skipped:\s*true/.test(constraintsSrc),
      "constraints.ts must NOT contain 'skipped: true' — soft-skip removed in v1.4.0",
    );
    assert.ok(
      !/reason:\s*["']entity_null["']/.test(constraintsSrc),
      "constraints.ts must NOT contain reason: 'entity_null' — soft-skip removed in v1.4.0",
    );
    // Must contain identity_not_ambiguous constraint
    assert.ok(
      /identity_not_ambiguous/.test(constraintsSrc),
      "constraints.ts must contain identity_not_ambiguous constraint (v1.4.0)",
    );
  });

  test("[guard-17] CHECK constraint migration must include all 5 phases", () => {
    assert.ok(
      /PROCESSING_COMPLETE/.test(constraintMigrationSrc),
      "Migration must include PROCESSING_COMPLETE in constraint",
    );
    assert.ok(
      /PROCESSING_COMPLETE_WITH_ERRORS/.test(constraintMigrationSrc),
      "Migration must include PROCESSING_COMPLETE_WITH_ERRORS in constraint",
    );
    assert.ok(
      /CONFIRMED_READY_FOR_PROCESSING/.test(constraintMigrationSrc),
      "Migration must include CONFIRMED_READY_FOR_PROCESSING in constraint",
    );
    assert.ok(
      /BULK_UPLOADED/.test(constraintMigrationSrc),
      "Migration must include BULK_UPLOADED in constraint",
    );
    assert.ok(
      /CLASSIFIED_PENDING_CONFIRMATION/.test(constraintMigrationSrc),
      "Migration must include CLASSIFIED_PENDING_CONFIRMATION in constraint",
    );
  });
});
