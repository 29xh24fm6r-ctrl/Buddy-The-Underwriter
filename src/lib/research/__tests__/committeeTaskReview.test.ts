import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCommitteeTaskReview,
  validateCommitteeTaskReview,
  mapActionToReviewStatus,
  buildReviewAuditRow,
  isCommitteeReviewAction,
  COMMITTEE_REVIEW_ACTIONS,
  type ReviewableTask,
  type CommitteeReviewAction,
} from "@/lib/research/committeeTaskReview";

/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
 * Pure review-action layer for committee evidence tasks.
 */

const NOW = "2026-06-04T12:00:00.000Z";
const ACTOR = "user_123";

function task(over: Partial<ReviewableTask>): ReviewableTask {
  return {
    id: "task-1",
    mission_id: "m-1",
    deal_id: "d-1",
    resolved_status: "collected",
    auto_clear_forbidden: false,
    review_status: "unreviewed",
    ...over,
  };
}

const opts = (o: Partial<{ note: string; reason: string }> = {}) => ({ ...o, actorId: ACTOR, now: NOW });

// ── mapping ──────────────────────────────────────────────────────────────────

test("[map] every action maps to a review status", () => {
  assert.equal(mapActionToReviewStatus("accept"), "accepted");
  assert.equal(mapActionToReviewStatus("reject"), "rejected");
  assert.equal(mapActionToReviewStatus("mark_weak_source"), "weak_source");
  assert.equal(mapActionToReviewStatus("mark_wrong_entity"), "wrong_entity");
  assert.equal(mapActionToReviewStatus("mark_committee_grade"), "committee_grade");
  assert.equal(mapActionToReviewStatus("request_more_evidence"), "needs_more_evidence");
  assert.equal(mapActionToReviewStatus("reset_review"), "unreviewed");
});

test("[map] isCommitteeReviewAction guards unknown actions", () => {
  for (const a of COMMITTEE_REVIEW_ACTIONS) assert.ok(isCommitteeReviewAction(a));
  assert.equal(isCommitteeReviewAction("promote"), false);
  assert.equal(isCommitteeReviewAction(undefined), false);
});

// ── accept ───────────────────────────────────────────────────────────────────

test("[accept] collected task => accepted", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "collected" }), "accept", opts());
  assert.ok(r.ok);
  assert.equal(r.patch.review_status, "accepted");
  assert.equal(r.patch.committee_grade_accepted, false);
  assert.equal(r.patch.reviewed_by, ACTOR);
  assert.equal(r.patch.reviewed_at, NOW);
});

test("[accept] needs_review task => accepted", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "needs_review" }), "accept", opts());
  assert.ok(r.ok);
  assert.equal(r.patch.review_status, "accepted");
});

test("[accept] missing task => error, not acceptable", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "accept", opts());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, "task_not_acceptable");
    assert.equal(r.status, 409);
  }
});

// ── reject / wrong_entity require a reason ────────────────────────────────────

test("[reject] requires a reason", () => {
  const noReason = applyCommitteeTaskReview(task({}), "reject", opts());
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.equal(noReason.error, "reason_required");

  const withReason = applyCommitteeTaskReview(task({}), "reject", opts({ reason: "stale source" }));
  assert.ok(withReason.ok);
  if (withReason.ok) {
    assert.equal(withReason.patch.review_status, "rejected");
    assert.equal(withReason.patch.review_reason, "stale source");
  }
});

test("[wrong_entity] requires a reason and never sets committee_grade_accepted", () => {
  const noReason = applyCommitteeTaskReview(task({}), "mark_wrong_entity", opts());
  assert.equal(noReason.ok, false);
  if (!noReason.ok) assert.equal(noReason.error, "reason_required");

  const r = applyCommitteeTaskReview(
    task({ resolved_status: "collected" }),
    "mark_wrong_entity",
    opts({ reason: "different OmniCare (CVS pharmacy)" }),
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.review_status, "wrong_entity");
    assert.equal(r.patch.committee_grade_accepted, false);
  }
});

test("[reject] blank/whitespace reason is rejected", () => {
  const r = applyCommitteeTaskReview(task({}), "reject", opts({ reason: "   " }));
  assert.equal(r.ok, false);
});

// ── committee grade ───────────────────────────────────────────────────────────

test("[committee_grade] collected, non-auto-clear => committee_grade + committee_grade_accepted true", () => {
  const r = applyCommitteeTaskReview(
    task({ resolved_status: "collected", auto_clear_forbidden: false }),
    "mark_committee_grade",
    opts(),
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.review_status, "committee_grade");
    assert.equal(r.patch.committee_grade_accepted, true);
  }
});

test("[committee_grade] needs_review, non-auto-clear => accepted", () => {
  const r = applyCommitteeTaskReview(
    task({ resolved_status: "needs_review", auto_clear_forbidden: false }),
    "mark_committee_grade",
    opts(),
  );
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.patch.committee_grade_accepted, true);
});

test("[committee_grade] auto_clear_forbidden (scale_plausibility) => error", () => {
  const r = applyCommitteeTaskReview(
    task({ resolved_status: "needs_review", auto_clear_forbidden: true }),
    "mark_committee_grade",
    opts(),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, "auto_clear_forbidden_not_committee_gradeable");
    assert.equal(r.status, 409);
  }
});

test("[committee_grade] missing task => error", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "mark_committee_grade", opts());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "task_not_committee_gradeable");
});

test("[committee_grade] auto_clear_forbidden task CAN still be accepted (reviewed)", () => {
  const r = applyCommitteeTaskReview(
    task({ resolved_status: "needs_review", auto_clear_forbidden: true }),
    "accept",
    opts(),
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.review_status, "accepted");
    assert.equal(r.patch.committee_grade_accepted, false);
  }
});

// ── other actions ─────────────────────────────────────────────────────────────

test("[request_more_evidence] => needs_more_evidence", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "request_more_evidence", opts());
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.patch.review_status, "needs_more_evidence");
});

test("[mark_weak_source] => weak_source (note optional)", () => {
  const r = applyCommitteeTaskReview(task({}), "mark_weak_source", opts({ note: "blog, not primary" }));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.review_status, "weak_source");
    assert.equal(r.patch.review_note, "blog, not primary");
  }
});

test("[reset_review] => unreviewed, clears reviewer/note/reason/committee flag", () => {
  const r = applyCommitteeTaskReview(
    task({ resolved_status: "collected", review_status: "committee_grade" }),
    "reset_review",
    opts({ note: "ignored", reason: "ignored" }),
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.patch, {
      review_status: "unreviewed",
      review_note: null,
      review_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      committee_grade_accepted: false,
    });
  }
});

test("[validate] unknown action => invalid_action", () => {
  const r = validateCommitteeTaskReview(task({}), "promote" as CommitteeReviewAction, opts());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "invalid_action");
});

// ── audit row ─────────────────────────────────────────────────────────────────

test("[audit] row captures action, transition, and trusted mission/deal from the task", () => {
  const t = task({ id: "abc", mission_id: "m-9", deal_id: "d-9", review_status: "unreviewed" });
  const row = buildReviewAuditRow({
    task: t,
    action: "mark_committee_grade",
    newStatus: mapActionToReviewStatus("mark_committee_grade"),
    opts: { note: "verified domain", reason: null, actorId: ACTOR },
  });
  assert.equal(row.task_id, "abc");
  assert.equal(row.mission_id, "m-9"); // from task, not client
  assert.equal(row.deal_id, "d-9"); // from task, not client
  assert.equal(row.action, "mark_committee_grade");
  assert.equal(row.previous_review_status, "unreviewed");
  assert.equal(row.new_review_status, "committee_grade");
  assert.equal(row.note, "verified domain");
  assert.equal(row.actor_id, ACTOR);
});

test("[audit] previous_review_status reflects the prior state on a re-review", () => {
  const row = buildReviewAuditRow({
    task: task({ review_status: "accepted" }),
    action: "reset_review",
    newStatus: "unreviewed",
    opts: { actorId: ACTOR },
  });
  assert.equal(row.previous_review_status, "accepted");
  assert.equal(row.new_review_status, "unreviewed");
});

// SPEC-COMMITTEE-ACTION-CENTER-WORKFLOW-RESOLUTION-1 — banker-attested resolutions
test("[screening] clear/finding on a missing task → banker_attested, never committee-grade", () => {
  for (const result of ["clear", "finding"] as const) {
    const r = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "record_screening_result", { result, note: "screened", now: NOW, actorId: ACTOR });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.patch.review_status, "banker_attested");
      assert.equal(r.patch.committee_grade_accepted, false);
      assert.equal(r.patch.review_reason, `screening_result:${result}`);
    }
  }
});

test("[screening] unable_to_verify does NOT resolve (downgrades to needs_more_evidence)", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "record_screening_result", { result: "unable_to_verify", now: NOW });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.patch.review_status, "needs_more_evidence");
});

test("[screening] requires a valid result", () => {
  const r = validateCommitteeTaskReview(task({ resolved_status: "missing" }), "record_screening_result", {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "result_required");
});

test("[scale conclusion] resolves an auto_clear_forbidden task via banker_attested (not committee-grade)", () => {
  const r = applyCommitteeTaskReview(task({ resolved_status: "missing", auto_clear_forbidden: true }), "submit_analyst_conclusion", { note: "Revenue ramp consistent with staffing + collateral.", now: NOW });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.review_status, "banker_attested");
    assert.equal(r.patch.committee_grade_accepted, false);
    assert.match(r.patch.review_note ?? "", /revenue ramp/i);
  }
});

test("[scale conclusion] requires conclusion text", () => {
  const r = validateCommitteeTaskReview(task({ auto_clear_forbidden: true }), "submit_analyst_conclusion", {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, "conclusion_required");
});

test("[override] requires a reason; resolves via banker_attested", () => {
  const bad = validateCommitteeTaskReview(task({ resolved_status: "missing" }), "banker_override", {});
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error, "reason_required");
  const ok = applyCommitteeTaskReview(task({ resolved_status: "missing" }), "banker_override", { reason: "Registry has no linkable detail URL; verified by phone.", now: NOW });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.patch.review_status, "banker_attested");
    assert.equal(ok.patch.committee_grade_accepted, false);
  }
});

test("[guard] new actions are recognized + in the action list", () => {
  for (const a of ["record_screening_result", "submit_analyst_conclusion", "banker_override"] as const) {
    assert.ok(isCommitteeReviewAction(a));
    assert.ok(COMMITTEE_REVIEW_ACTIONS.includes(a));
  }
});
