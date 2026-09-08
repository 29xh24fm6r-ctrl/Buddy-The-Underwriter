import test from "node:test";
import assert from "node:assert/strict";

import {
  LIFECYCLE_STAGES,
  isStageAtOrBeyond,
  lifecycleStageIndex,
} from "@/buddy/lifecycle/stages";

test("every stage has a position in the progression", () => {
  for (const s of LIFECYCLE_STAGES) {
    assert.ok(lifecycleStageIndex(s.code) >= 0, s.code);
  }
});

test("a deal in underwriting is at or beyond underwrite_ready", () => {
  // Production 2026-09-08 18:02 UTC: deal c0f6caab (underwrite_in_progress)
  // reached research readiness; the reconciler's target was underwrite_ready.
  // It must not be asked to advance again.
  assert.equal(isStageAtOrBeyond("underwrite_in_progress", "underwrite_ready"), true);
  assert.equal(isStageAtOrBeyond("underwrite_ready", "underwrite_ready"), true);
  assert.equal(isStageAtOrBeyond("committee_ready", "memo_inputs_required"), true);
});

test("a deal still collecting inputs is behind underwrite_ready", () => {
  assert.equal(isStageAtOrBeyond("memo_inputs_required", "underwrite_ready"), false);
  assert.equal(isStageAtOrBeyond("docs_satisfied", "memo_inputs_required"), false);
});

test("workout is a terminal branch and never advances", () => {
  assert.equal(isStageAtOrBeyond("workout", "underwrite_ready"), true);
});
