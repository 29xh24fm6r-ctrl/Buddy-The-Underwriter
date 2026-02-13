/**
 * Spread Enqueue Robustness — Invariant Tests
 *
 * Locks the following invariants:
 * A) requested_spread_types only includes types with registered templates
 * B) Placeholders created at correct spread_version
 * C) CAS claim pins spread_version deterministically
 * D) Jobs that render 0 spreads surface as FAILED, not silent SUCCEEDED
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

// Stub "server-only" so template imports don't throw in test context.
const emptyJs = path.resolve("node_modules/server-only/empty.js");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...args: any[]
) {
  if (request === "server-only") {
    return emptyJs;
  }
  return originalResolve.call(this, request, ...args);
};

const ENQUEUE_SRC = fs.readFileSync(
  "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
  "utf-8",
);
const PROCESSOR_SRC = fs.readFileSync(
  "src/lib/jobs/processors/spreadsProcessor.ts",
  "utf-8",
);

// ── Suite 1: Enqueue type validation ────────────────────────────────────

describe("enqueue type validation", () => {
  it("does NOT throw for unknown types inside Promise.all", () => {
    // The old pattern: throw new Error(`Unknown spread template: ${t}`)
    // inside the Promise.all map. This should be gone.
    const promiseAllBlock = ENQUEUE_SRC.slice(
      ENQUEUE_SRC.indexOf("Promise.all"),
      ENQUEUE_SRC.indexOf("catch (placeholderErr)"),
    );
    assert.ok(
      !promiseAllBlock.includes("throw new Error"),
      "enqueueSpreadRecompute still throws inside Promise.all map — one bad type poisons all",
    );
  });

  it("filters invalid types before placeholder creation", () => {
    assert.ok(
      ENQUEUE_SRC.includes("validTypes") && ENQUEUE_SRC.includes("invalidTypes"),
      "enqueueSpreadRecompute must split requested into validTypes/invalidTypes",
    );
  });

  it("uses validTypes for job payload", () => {
    assert.ok(
      ENQUEUE_SRC.includes("requested_spread_types: validTypes"),
      "enqueueSpreadRecompute must use validTypes (not requested) for job payload",
    );
  });

  it("emits system event for invalid types", () => {
    assert.ok(
      ENQUEUE_SRC.includes("INVALID_SPREAD_TYPES_SKIPPED"),
      "enqueueSpreadRecompute must emit INVALID_SPREAD_TYPES_SKIPPED event",
    );
  });
});

// ── Suite 2: Processor CAS version pin ──────────────────────────────────

describe("processor CAS version pin", () => {
  it("CAS claim includes spread_version", () => {
    // Find the CAS claim block (between "transition queued→generating" and "maybeSingle")
    const casStart = PROCESSOR_SRC.indexOf("transition queued");
    const casEnd = PROCESSOR_SRC.indexOf(".maybeSingle()", casStart);
    const casBlock = PROCESSOR_SRC.slice(casStart, casEnd);
    assert.ok(
      casBlock.includes('.eq("spread_version"'),
      "CAS claim must include .eq(\"spread_version\") for deterministic claiming",
    );
  });

  it("skips unknown types with SPREAD_TEMPLATE_MISSING_IN_JOB event", () => {
    assert.ok(
      PROCESSOR_SRC.includes("SPREAD_TEMPLATE_MISSING_IN_JOB"),
      "spreadsProcessor must emit SPREAD_TEMPLATE_MISSING_IN_JOB when template is missing",
    );
  });

  it("emits SPREAD_PLACEHOLDER_MISSING event on missing placeholder", () => {
    assert.ok(
      PROCESSOR_SRC.includes("SPREAD_PLACEHOLDER_MISSING"),
      "spreadsProcessor must emit SPREAD_PLACEHOLDER_MISSING when CAS claim fails",
    );
  });
});

// ── Suite 3: Job outcome semantics ──────────────────────────────────────

describe("job outcome semantics", () => {
  it("does not unconditionally mark jobs as SUCCEEDED", () => {
    assert.ok(
      PROCESSOR_SRC.includes("NO_SPREADS_RENDERED") || PROCESSOR_SRC.includes("SPREAD_JOB_NOOP"),
      "spreadsProcessor must handle 0-render case with explicit error code",
    );
  });

  it("tracks renderedCount vs attemptedCount", () => {
    assert.ok(
      PROCESSOR_SRC.includes("renderedCount") && PROCESSOR_SRC.includes("completedTypes.size"),
      "spreadsProcessor must compute renderedCount from completedTypes.size",
    );
  });

  it("marks 0-render jobs as FAILED", () => {
    // Verify that renderedCount === 0 leads to FAILED status
    const outcomeBlock = PROCESSOR_SRC.slice(
      PROCESSOR_SRC.indexOf("renderedCount === 0"),
      PROCESSOR_SRC.indexOf("renderedCount === 0") + 500,
    );
    assert.ok(
      outcomeBlock.includes('"FAILED"'),
      "Jobs with renderedCount === 0 must be marked FAILED",
    );
  });
});

// ── Suite 4: Template registry completeness ─────────────────────────────

describe("template registry completeness", () => {
  it("getSpreadTemplate returns null for PERSONAL_CASH_FLOW", async () => {
    const { getSpreadTemplate } = await import("../templates");
    const tpl = getSpreadTemplate("PERSONAL_CASH_FLOW" as any);
    assert.strictEqual(tpl, null, "PERSONAL_CASH_FLOW must NOT have a template");
  });

  it("ALL_SPREAD_TYPES does not contain PERSONAL_CASH_FLOW", async () => {
    const { ALL_SPREAD_TYPES } = await import("../types");
    assert.ok(
      !ALL_SPREAD_TYPES.includes("PERSONAL_CASH_FLOW" as any),
      "PERSONAL_CASH_FLOW must NOT be in ALL_SPREAD_TYPES",
    );
  });
});

// ── Suite 5: Error-path CAS version pin ─────────────────────────────────

describe("error-path CAS cleanup", () => {
  it("error-path CAS cleanup includes spread_version", () => {
    // Find the error-path block (after "NON-NEGOTIABLE: clean up")
    const errorPathStart = PROCESSOR_SRC.indexOf("NON-NEGOTIABLE: clean up");
    const errorPathEnd = PROCESSOR_SRC.indexOf("reconcileAegisFindingsForSpread", errorPathStart);
    const errorBlock = PROCESSOR_SRC.slice(errorPathStart, errorPathEnd);
    assert.ok(
      errorBlock.includes('.eq("spread_version"') || errorBlock.includes(".eq(\"spread_version\""),
      "Error-path CAS cleanup must include .eq(\"spread_version\") for version-correct cleanup",
    );
  });
});
