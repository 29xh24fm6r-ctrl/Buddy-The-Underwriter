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

const claimRpcSrc = readSource(
  "supabase/migrations/20260226_claim_intake_outbox_rpc.sql",
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
});
