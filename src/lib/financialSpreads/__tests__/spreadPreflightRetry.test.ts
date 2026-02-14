/**
 * Spread Preflight Retry — Invariant Tests
 *
 * Verifies the processor-level preflight logic:
 * - 0 facts + no heartbeat → bounded retry (max 5)
 * - 0 facts + heartbeat → MISSING_UPSTREAM_FACTS error
 * - Per-spread prereq evaluation in processor source
 * - Retry counter is persisted (not in-memory)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("spread preflight retry", () => {
  const processorSrc = fs.readFileSync(
    "src/lib/jobs/processors/spreadsProcessor.ts",
    "utf-8",
  );

  it("processor checks EXTRACTION_HEARTBEAT for timing-race detection", () => {
    assert.ok(
      processorSrc.includes("EXTRACTION_HEARTBEAT"),
      "spreadsProcessor must check EXTRACTION_HEARTBEAT facts",
    );
  });

  it("processor implements bounded retry with max 5 attempts", () => {
    assert.ok(
      processorSrc.includes("preflight_retries"),
      "spreadsProcessor must track preflight_retries",
    );
    assert.ok(
      processorSrc.includes("< 5"),
      "spreadsProcessor must bound retries at 5",
    );
  });

  it("retry counter is persisted via job meta (not in-memory)", () => {
    // The retry counter must be stored in the job's meta field and persisted back
    assert.ok(
      processorSrc.includes("preflight_retries: preflightRetries + 1"),
      "spreadsProcessor must persist incremented preflight_retries in job meta",
    );
    assert.ok(
      processorSrc.includes('meta: { ...jobMeta, preflight_retries'),
      "spreadsProcessor must write preflight_retries back to job meta",
    );
  });

  it("emits SPREAD_JOB_DEFERRED_WAITING_ON_EXTRACTION on timing-race retry", () => {
    assert.ok(
      processorSrc.includes("SPREAD_JOB_DEFERRED_WAITING_ON_EXTRACTION"),
      "spreadsProcessor must emit SPREAD_JOB_DEFERRED_WAITING_ON_EXTRACTION event",
    );
  });

  it("emits SPREAD_JOB_NO_FACTS_TIMEOUT when retries exhausted", () => {
    assert.ok(
      processorSrc.includes("SPREAD_JOB_NO_FACTS_TIMEOUT"),
      "spreadsProcessor must emit SPREAD_JOB_NO_FACTS_TIMEOUT event",
    );
  });

  it("emits EXTRACTION_ZERO_FACTS when heartbeat exists but 0 visible facts", () => {
    assert.ok(
      processorSrc.includes("EXTRACTION_ZERO_FACTS"),
      "spreadsProcessor must emit EXTRACTION_ZERO_FACTS event",
    );
  });

  it("uses per-spread prerequisite evaluation (not global-only)", () => {
    assert.ok(
      processorSrc.includes("evaluatePrereq"),
      "spreadsProcessor must use evaluatePrereq for per-spread checks",
    );
    assert.ok(
      processorSrc.includes("readyTypes"),
      "spreadsProcessor must split into readyTypes",
    );
    assert.ok(
      processorSrc.includes("notReadyTypes"),
      "spreadsProcessor must track notReadyTypes",
    );
  });

  it("emits SPREAD_WAITING_ON_FACTS for not-ready types (non-terminal)", () => {
    assert.ok(
      processorSrc.includes("SPREAD_WAITING_ON_FACTS"),
      "spreadsProcessor must emit SPREAD_WAITING_ON_FACTS for types whose prereqs aren't met",
    );
  });

  it("does NOT add WAITING_ON_FACTS to SpreadErrorCode (non-terminal state)", () => {
    const errorCodesSrc = fs.readFileSync(
      "src/lib/financialSpreads/spreadErrorCodes.ts",
      "utf-8",
    );
    assert.ok(
      !errorCodesSrc.includes("WAITING_ON_FACTS"),
      "spreadErrorCodes.ts must NOT include WAITING_ON_FACTS — it's a non-terminal state",
    );
  });

  it("EMPTY_SPREAD_RENDERED is in SpreadErrorCode (empty spreads are errors)", () => {
    const errorCodesSrc = fs.readFileSync(
      "src/lib/financialSpreads/spreadErrorCodes.ts",
      "utf-8",
    );
    assert.ok(
      errorCodesSrc.includes("EMPTY_SPREAD_RENDERED"),
      "spreadErrorCodes.ts must include EMPTY_SPREAD_RENDERED",
    );
  });

  it("deterministic priority sort is applied to requested types", () => {
    assert.ok(
      processorSrc.includes("requested.sort"),
      "spreadsProcessor must sort requested types by priority",
    );
    assert.ok(
      processorSrc.includes("getSpreadTemplate(a)?.priority"),
      "spreadsProcessor must sort by template priority",
    );
  });

  it("enqueueSpreadRecompute gates on prerequisites", () => {
    const enqueueSrc = fs.readFileSync(
      "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
      "utf-8",
    );
    assert.ok(
      enqueueSrc.includes("evaluatePrereq"),
      "enqueueSpreadRecompute must use evaluatePrereq for readiness gate",
    );
    assert.ok(
      enqueueSrc.includes("readyTypes"),
      "enqueueSpreadRecompute must split into readyTypes",
    );
    assert.ok(
      enqueueSrc.includes("waitingOnFacts"),
      "enqueueSpreadRecompute must return waitingOnFacts when no types are ready",
    );
  });
});
