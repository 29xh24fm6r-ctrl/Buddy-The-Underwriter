import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_STAGE_TRANSITIONS,
  STAGE_LABELS,
} from "../model";
import type { LifecycleStage } from "../model";

// Stage transition tests
test("ALLOWED_STAGE_TRANSITIONS defines linear progression", () => {
  // Verify each stage has transitions defined
  const stages: LifecycleStage[] = [
    "intake_created",
    "docs_requested",
    "docs_in_progress",
    "docs_satisfied",
    "underwrite_ready",
    "underwrite_in_progress",
    "committee_ready",
    "committee_decisioned",
    "closing_in_progress",
    "closed",
    "workout",
  ];

  stages.forEach((stage) => {
    assert.ok(
      stage in ALLOWED_STAGE_TRANSITIONS,
      `Stage ${stage} should have transitions defined`
    );
  });
});

test("ALLOWED_STAGE_TRANSITIONS forms valid chain from intake to closed", () => {
  // Walk the chain from intake_created to closed
  let current: LifecycleStage = "intake_created";
  const visited: LifecycleStage[] = [current];

  while (current !== "closed") {
    const transitions: LifecycleStage[] = ALLOWED_STAGE_TRANSITIONS[current];
    assert.ok(transitions.length > 0, `Stage ${current} should have at least one transition`);
    current = transitions[0];
    visited.push(current);
    // Safety: prevent infinite loop
    if (visited.length > 15) break;
  }

  assert.equal(current, "closed", "Chain should end at closed");
  assert.ok(visited.includes("underwrite_in_progress"), "Chain should include underwrite_in_progress");
  assert.ok(visited.includes("committee_ready"), "Chain should include committee_ready");
});

test("ALLOWED_STAGE_TRANSITIONS has terminal states", () => {
  assert.deepEqual(ALLOWED_STAGE_TRANSITIONS["closed"], []);
  assert.deepEqual(ALLOWED_STAGE_TRANSITIONS["workout"], []);
});

test("committee_decisioned can branch to workout", () => {
  const transitions = ALLOWED_STAGE_TRANSITIONS["committee_decisioned"];
  assert.ok(transitions.includes("closing_in_progress"), "Can advance to closing");
  assert.ok(transitions.includes("workout"), "Can branch to workout");
});

// Stage labels tests
test("STAGE_LABELS defines labels for all stages", () => {
  const stages: LifecycleStage[] = [
    "intake_created",
    "docs_requested",
    "docs_in_progress",
    "docs_satisfied",
    "underwrite_ready",
    "underwrite_in_progress",
    "committee_ready",
    "committee_decisioned",
    "closing_in_progress",
    "closed",
    "workout",
  ];

  stages.forEach((stage) => {
    assert.ok(
      stage in STAGE_LABELS,
      `Stage ${stage} should have a label defined`
    );
    assert.ok(
      STAGE_LABELS[stage].length > 0,
      `Label for ${stage} should not be empty`
    );
  });
});

test("STAGE_LABELS are human readable", () => {
  assert.equal(STAGE_LABELS["intake_created"], "Deal Created");
  assert.equal(STAGE_LABELS["docs_requested"], "Documents Requested");
  assert.equal(STAGE_LABELS["underwrite_in_progress"], "Underwriting");
  assert.equal(STAGE_LABELS["closed"], "Closed");
});
