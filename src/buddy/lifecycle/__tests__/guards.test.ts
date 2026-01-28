import test from "node:test";
import assert from "node:assert/strict";

import { isStageAtOrBefore, STAGES_AT_OR_BEYOND } from "../guards";
import type { LifecycleStage } from "../model";

// ── isStageAtOrBefore ────────────────────────────────────────────────

test("isStageAtOrBefore: same stage returns true", () => {
  assert.equal(isStageAtOrBefore("committee_ready", "committee_ready"), true);
  assert.equal(isStageAtOrBefore("intake_created", "intake_created"), true);
  assert.equal(isStageAtOrBefore("closed", "closed"), true);
});

test("isStageAtOrBefore: earlier stage can reach ceiling", () => {
  assert.equal(isStageAtOrBefore("intake_created", "committee_ready"), true);
  assert.equal(isStageAtOrBefore("docs_requested", "underwrite_ready"), true);
  assert.equal(isStageAtOrBefore("docs_in_progress", "closed"), true);
});

test("isStageAtOrBefore: later stage cannot reach earlier ceiling", () => {
  assert.equal(isStageAtOrBefore("committee_ready", "docs_requested"), false);
  assert.equal(isStageAtOrBefore("closed", "intake_created"), false);
  assert.equal(isStageAtOrBefore("underwrite_in_progress", "docs_satisfied"), false);
});

test("isStageAtOrBefore: workout is reachable from committee_decisioned", () => {
  assert.equal(isStageAtOrBefore("committee_decisioned", "workout"), true);
  assert.equal(isStageAtOrBefore("intake_created", "workout"), true);
});

test("isStageAtOrBefore: workout is NOT reachable from closing_in_progress", () => {
  assert.equal(isStageAtOrBefore("closing_in_progress", "workout"), false);
  assert.equal(isStageAtOrBefore("closed", "workout"), false);
});

test("isStageAtOrBefore: closed is a terminal — nothing beyond it", () => {
  assert.equal(isStageAtOrBefore("closed", "committee_ready"), false);
  assert.equal(isStageAtOrBefore("closed", "intake_created"), false);
});

// ── Force-advance stage cap scenarios ────────────────────────────────

test("stage cap: default cap at committee_ready blocks closing and beyond", () => {
  const cap: LifecycleStage = "committee_ready";
  // These should be allowed (at or before cap)
  assert.equal(isStageAtOrBefore("intake_created", cap), true);
  assert.equal(isStageAtOrBefore("docs_satisfied", cap), true);
  assert.equal(isStageAtOrBefore("underwrite_in_progress", cap), true);
  assert.equal(isStageAtOrBefore("committee_ready", cap), true);
  // These should be blocked (beyond cap)
  assert.equal(isStageAtOrBefore("committee_decisioned", cap), false);
  assert.equal(isStageAtOrBefore("closing_in_progress", cap), false);
  assert.equal(isStageAtOrBefore("closed", cap), false);
});

// ── STAGES_AT_OR_BEYOND map integrity ────────────────────────────────

test("STAGES_AT_OR_BEYOND includes every stage as a key", () => {
  const allStages: LifecycleStage[] = [
    "intake_created", "docs_requested", "docs_in_progress", "docs_satisfied",
    "underwrite_ready", "underwrite_in_progress", "committee_ready",
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ];
  for (const s of allStages) {
    assert.ok(STAGES_AT_OR_BEYOND[s], `Missing key: ${s}`);
    assert.ok(STAGES_AT_OR_BEYOND[s].has(s), `${s} should include itself`);
  }
});

test("STAGES_AT_OR_BEYOND: closed set contains only closed", () => {
  assert.equal(STAGES_AT_OR_BEYOND["closed"].size, 1);
  assert.ok(STAGES_AT_OR_BEYOND["closed"].has("closed"));
});

test("STAGES_AT_OR_BEYOND: workout set contains only workout", () => {
  assert.equal(STAGES_AT_OR_BEYOND["workout"].size, 1);
  assert.ok(STAGES_AT_OR_BEYOND["workout"].has("workout"));
});
