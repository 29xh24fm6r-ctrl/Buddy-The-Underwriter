/**
 * CI Source Guards — Intake Process Route Invariants
 *
 * These are SOURCE GUARDS (string/regex) — not integration tests.
 * They read the intake/process route as a string and assert structural
 * invariants that must hold across formatting and refactoring changes.
 *
 * Updated for Phase E3: route is now a thin wrapper that delegates to
 * runIntakeProcessing(). Guards 2-4 now check the pure execution function
 * instead of the route directly.
 *
 * Enforced invariants:
 *  1. Pure function checks finalized_at (precondition validation)
 *  2. Pure function calls backfillDealArtifacts (artifact backfill)
 *  3. Pure function calls writeEvent (canonical event emission)
 *  4. Pure function calls enqueueDealProcessing (processing trigger)
 *  5. Route does NOT import orchestrateIntake (boundary separation)
 *  6. Route accepts banker auth via requireRoleApi
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

const processSrc = readSource(
  "src/app/api/deals/[dealId]/intake/process/route.ts",
);

const runProcessingSrc = readSource(
  "src/lib/intake/processing/runIntakeProcessing.ts",
);

describe("Intake Process Route Guards", () => {
  test("[guard-1] pure function must check finalized_at precondition", () => {
    assert.ok(
      /finalized_at/.test(runProcessingSrc),
      "runIntakeProcessing must reference finalized_at for precondition validation",
    );
    assert.ok(
      /documents_not_confirmed/.test(runProcessingSrc),
      'runIntakeProcessing must throw with "documents_not_confirmed" when docs not finalized',
    );
  });

  test("[guard-2] pure function must call backfillDealArtifacts", () => {
    assert.ok(
      /backfillDealArtifacts/.test(runProcessingSrc),
      "runIntakeProcessing must call backfillDealArtifacts to ensure all docs have artifacts",
    );
    assert.ok(
      /import.*backfillDealArtifacts/.test(runProcessingSrc) ||
        /from\s+["']@\/lib\/artifacts\/queueArtifact["']/.test(runProcessingSrc),
      "runIntakeProcessing must import backfillDealArtifacts from @/lib/artifacts/queueArtifact",
    );
  });

  test("[guard-3] pure function must call writeEvent for canonical event emission", () => {
    assert.ok(
      /writeEvent/.test(runProcessingSrc),
      "runIntakeProcessing must call writeEvent for deal_events emission",
    );
    assert.ok(
      /intake\.processing_started/.test(runProcessingSrc),
      'runIntakeProcessing must emit "intake.processing_started" event',
    );
    assert.ok(
      /intake\.artifacts_backfilled/.test(runProcessingSrc),
      'runIntakeProcessing must emit "intake.artifacts_backfilled" event',
    );
  });

  test("[guard-4] pure function must call enqueueDealProcessing", () => {
    assert.ok(
      /enqueueDealProcessing/.test(runProcessingSrc),
      "runIntakeProcessing must call enqueueDealProcessing for processing trigger",
    );
    assert.ok(
      /import.*enqueueDealProcessing/.test(runProcessingSrc) ||
        /from\s+["']@\/lib\/intake\/processing\/enqueueDealProcessing["']/.test(
          runProcessingSrc,
        ),
      "runIntakeProcessing must import enqueueDealProcessing",
    );
  });

  test("[guard-5] route must NOT import orchestrateIntake", () => {
    assert.ok(
      !/orchestrateIntake/.test(processSrc),
      "Route must NOT reference orchestrateIntake — boundary separation",
    );
  });

  test("[guard-6] route must accept banker auth via requireRoleApi", () => {
    assert.ok(
      /requireRoleApi/.test(processSrc),
      "Route must call requireRoleApi for banker auth path",
    );
    assert.ok(
      /ensureDealBankAccess/.test(processSrc),
      "Route must call ensureDealBankAccess for bank ownership verification",
    );
  });
});
