/**
 * SPEC-INTAKE-FLOW-FIX-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HANDLER_SRC = readFileSync(
  resolve(__dirname, "../../../../app/api/workers/[...path]/_handlers/intake-outbox.ts"),
  "utf-8",
);
const OUTBOX_SRC = readFileSync(
  resolve(__dirname, "../../../workers/processIntakeOutbox.ts"),
  "utf-8",
);
const CONFIRMED_SRC = readFileSync(
  resolve(__dirname, "../processConfirmedIntake.ts"),
  "utf-8",
);
const RECOVERY_SRC = readFileSync(
  resolve(__dirname, "../handleStuckRecovery.ts"),
  "utf-8",
);

describe("SPEC-INTAKE-FLOW-FIX-1 guards", () => {
  // Fix 1: Advisory lock removed from route handler
  test("intake-outbox handler does NOT use withWorkerAdvisoryLock", () => {
    assert.ok(
      !HANDLER_SRC.includes("withWorkerAdvisoryLock"),
      "Route handler must not wrap processIntakeOutbox in advisory lock",
    );
  });

  test("processIntakeOutbox does not import withWorkerAdvisoryLock", () => {
    assert.ok(
      !OUTBOX_SRC.includes("withWorkerAdvisoryLock"),
      "processIntakeOutbox must not use advisory lock — claim RPC is the concurrency guard",
    );
  });

  // Fix 2: Slot seeding before doc loop
  test("processConfirmedIntake calls ensureCoreDocumentSlots", () => {
    assert.ok(
      CONFIRMED_SRC.includes("ensureCoreDocumentSlots"),
      "Must seed slots before per-doc processing",
    );
  });

  test("slot seeding happens before DOC_CONCURRENCY", () => {
    const slotIdx = CONFIRMED_SRC.indexOf("ensureCoreDocumentSlots");
    const concurrencyIdx = CONFIRMED_SRC.indexOf("DOC_CONCURRENCY");
    assert.ok(slotIdx > 0 && concurrencyIdx > 0);
    assert.ok(
      slotIdx < concurrencyIdx,
      "ensureCoreDocumentSlots must be called before DOC_CONCURRENCY processing",
    );
  });

  // Fix 3: Recovery lock check
  test("stuck recovery checks advisory lock before re-enqueue", () => {
    assert.ok(
      RECOVERY_SRC.includes("pg_terminate_backend_holding_advisory_lock"),
      "Recovery must attempt to terminate zombie lock holder before enqueuing",
    );
  });
});
