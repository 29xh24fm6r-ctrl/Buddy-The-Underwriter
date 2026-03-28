import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAutoAdvance, type AutoAdvanceInput } from "./evaluateAutoAdvance";

const BASE_INPUT: AutoAdvanceInput = {
  canonicalStage: "docs_in_progress",
  blockerCodes: [],
  borrowerCampaignsComplete: true,
  nextActions: [],
};

test("completed borrower campaigns advance docs_in_progress -> docs_satisfied", () => {
  const result = evaluateAutoAdvance(BASE_INPUT);
  assert.ok(result.eligible);
  assert.equal(result.fromStage, "docs_in_progress");
  assert.equal(result.toStage, "docs_satisfied");
  assert.equal(result.triggerCode, "borrower_campaigns_complete");
});

test("open blockers prevent auto-advance", () => {
  const result = evaluateAutoAdvance({
    ...BASE_INPUT,
    blockerCodes: ["gatekeeper_docs_incomplete"],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reason.includes("gatekeeper_docs_incomplete"));
});

test("incomplete borrower campaigns prevent campaign-triggered advance", () => {
  const result = evaluateAutoAdvance({
    ...BASE_INPUT,
    borrowerCampaignsComplete: false,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reason.includes("not yet complete"));
});

test("readiness blockers cleared advances docs_satisfied -> underwrite_ready", () => {
  const result = evaluateAutoAdvance({
    ...BASE_INPUT,
    canonicalStage: "docs_satisfied",
    blockerCodes: [],
    borrowerCampaignsComplete: true,
  });
  assert.ok(result.eligible);
  assert.equal(result.toStage, "underwrite_ready");
});

test("terminal stage (closed) returns not eligible", () => {
  const result = evaluateAutoAdvance({
    ...BASE_INPUT,
    canonicalStage: "closed",
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reason.includes("No auto-advance rule"));
});

test("partial evidence (some blockers present) does not advance", () => {
  const result = evaluateAutoAdvance({
    ...BASE_INPUT,
    canonicalStage: "underwrite_in_progress",
    blockerCodes: ["risk_pricing_not_finalized"],
  });
  assert.equal(result.eligible, false);
});
