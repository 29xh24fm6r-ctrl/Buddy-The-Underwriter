/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
 *
 * Pure review-action layer for committee evidence tasks. Turns a banker/analyst
 * review ACTION into the durable review state to persist on
 * buddy_research_committee_tasks plus an audit row for
 * buddy_research_committee_task_reviews.
 *
 * Pure module — no server-only, no DB, no fabrication, fully unit-testable. It
 * NEVER changes trust_grade / gate_passed / preliminary_eligible /
 * committee_eligible and NEVER clears a committee blocker. It only records
 * review intent + the gated `committee_grade_accepted` flag (rule 5). The
 * file-derived `resolved_status` and `auto_clear_forbidden` are inputs only —
 * this module does not recompute them.
 */

export type CommitteeReviewAction =
  | "accept"
  | "reject"
  | "mark_weak_source"
  | "mark_wrong_entity"
  | "mark_committee_grade"
  | "request_more_evidence"
  | "reset_review"
  // SPEC-COMMITTEE-ACTION-CENTER-WORKFLOW-RESOLUTION-1: banker-attested in-place
  // resolutions that the standard actions cannot express (missing /
  // auto_clear_forbidden tasks). They record an explicit human result and never
  // change gate scoring; the committee-readiness view re-derives "resolved".
  | "record_screening_result"
  | "submit_analyst_conclusion"
  | "banker_override";

export type CommitteeReviewStatus =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "weak_source"
  | "wrong_entity"
  | "committee_grade"
  | "needs_more_evidence"
  | "banker_attested";

export const COMMITTEE_REVIEW_ACTIONS: CommitteeReviewAction[] = [
  "accept",
  "reject",
  "mark_weak_source",
  "mark_wrong_entity",
  "mark_committee_grade",
  "request_more_evidence",
  "reset_review",
  "record_screening_result",
  "submit_analyst_conclusion",
  "banker_override",
];

/** Screening outcome for record_screening_result. */
export type ScreeningResult = "clear" | "finding" | "unable_to_verify";
export const SCREENING_RESULTS: ScreeningResult[] = ["clear", "finding", "unable_to_verify"];

/** The minimal task shape the review layer needs (read from the DB row). */
export type ReviewableTask = {
  id: string;
  mission_id?: string | null;
  deal_id?: string | null;
  /** Persisted file-derived status (missing | collected | needs_review | accepted | rejected). */
  resolved_status?: string | null;
  /** Contradiction / scale tasks that must never auto-clear / reach committee-grade. */
  auto_clear_forbidden?: boolean | null;
  /** Current review_status (defaults to "unreviewed"). */
  review_status?: string | null;
};

export type CommitteeReviewOpts = {
  note?: string | null;
  reason?: string | null;
  actorId?: string | null;
  /** record_screening_result outcome. */
  result?: ScreeningResult | string | null;
  /** Injected for determinism/testability; defaults applied by the caller. */
  now?: string;
};

export type CommitteeReviewError =
  | "invalid_action"
  | "task_not_acceptable"
  | "task_not_committee_gradeable"
  | "auto_clear_forbidden_not_committee_gradeable"
  | "reason_required"
  | "result_required"
  | "conclusion_required";

export type ReviewValidation =
  | { ok: true }
  | { ok: false; error: CommitteeReviewError; status: number; detail: string };

/** Statuses from which a task may be accepted or promoted to committee-grade. */
const ACCEPTABLE_RESOLVED = new Set(["collected", "needs_review"]);

export function isCommitteeReviewAction(v: unknown): v is CommitteeReviewAction {
  return typeof v === "string" && (COMMITTEE_REVIEW_ACTIONS as string[]).includes(v);
}

/** Map a review action to the review_status it produces. */
export function mapActionToReviewStatus(action: CommitteeReviewAction): CommitteeReviewStatus {
  switch (action) {
    case "accept":
      return "accepted";
    case "reject":
      return "rejected";
    case "mark_weak_source":
      return "weak_source";
    case "mark_wrong_entity":
      return "wrong_entity";
    case "mark_committee_grade":
      return "committee_grade";
    case "request_more_evidence":
      return "needs_more_evidence";
    case "reset_review":
      return "unreviewed";
    // Banker-attested resolutions. record_screening_result with an
    // "unable_to_verify" outcome is downgraded to needs_more_evidence in apply().
    case "record_screening_result":
    case "submit_analyst_conclusion":
    case "banker_override":
      return "banker_attested";
  }
}

const hasText = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

/**
 * Enforce the review rules:
 *  1. Only collected / needs_review tasks can be accepted or marked committee_grade.
 *  2. Missing tasks cannot be accepted.
 *  3. Rejection requires a reason.
 *  4. mark_wrong_entity requires a reason (and never clears a blocker — handled
 *     by NOT touching gate/blocker state anywhere in this layer).
 *  5/6. auto_clear_forbidden (e.g. scale_plausibility) cannot be committee_grade.
 */
export function validateCommitteeTaskReview(
  task: ReviewableTask,
  action: CommitteeReviewAction,
  opts: CommitteeReviewOpts = {},
): ReviewValidation {
  if (!isCommitteeReviewAction(action)) {
    return { ok: false, error: "invalid_action", status: 400, detail: `unknown action: ${String(action)}` };
  }

  const resolved = (task.resolved_status ?? "").toString();
  const acceptable = ACCEPTABLE_RESOLVED.has(resolved);

  switch (action) {
    case "accept":
      if (!acceptable) {
        return {
          ok: false,
          error: "task_not_acceptable",
          status: 409,
          detail: `only collected/needs_review tasks can be accepted (resolved_status=${resolved || "none"})`,
        };
      }
      return { ok: true };

    case "mark_committee_grade":
      if (!acceptable) {
        return {
          ok: false,
          error: "task_not_committee_gradeable",
          status: 409,
          detail: `only collected/needs_review tasks can be marked committee-grade (resolved_status=${resolved || "none"})`,
        };
      }
      if (task.auto_clear_forbidden) {
        return {
          ok: false,
          error: "auto_clear_forbidden_not_committee_gradeable",
          status: 409,
          detail: "auto_clear_forbidden tasks (e.g. scale_plausibility) cannot be marked committee-grade",
        };
      }
      return { ok: true };

    case "reject":
      if (!hasText(opts.reason)) {
        return { ok: false, error: "reason_required", status: 400, detail: "reject requires a reason" };
      }
      return { ok: true };

    case "mark_wrong_entity":
      if (!hasText(opts.reason)) {
        return { ok: false, error: "reason_required", status: 400, detail: "mark_wrong_entity requires a reason" };
      }
      return { ok: true };

    case "record_screening_result":
      if (!SCREENING_RESULTS.includes((opts.result ?? "") as ScreeningResult)) {
        return { ok: false, error: "result_required", status: 400, detail: "record_screening_result requires result in clear|finding|unable_to_verify" };
      }
      return { ok: true };

    case "submit_analyst_conclusion":
      // The explicit human conclusion text is the resolution (stored in the note).
      if (!hasText(opts.note)) {
        return { ok: false, error: "conclusion_required", status: 400, detail: "submit_analyst_conclusion requires a conclusion" };
      }
      return { ok: true };

    case "banker_override":
      if (!hasText(opts.reason)) {
        return { ok: false, error: "reason_required", status: 400, detail: "banker_override requires a reason" };
      }
      return { ok: true };

    case "mark_weak_source":
    case "request_more_evidence":
    case "reset_review":
      return { ok: true };
  }
}

export type CommitteeReviewPatch = {
  review_status: CommitteeReviewStatus;
  review_note: string | null;
  review_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  committee_grade_accepted: boolean;
};

/**
 * Whether committee_grade_accepted may be true (rule 5): review_status is
 * committee_grade, resolved_status is collected/needs_review, and the task is
 * not auto_clear_forbidden.
 */
export function canAcceptCommitteeGrade(
  task: ReviewableTask,
  newStatus: CommitteeReviewStatus,
): boolean {
  return (
    newStatus === "committee_grade" &&
    ACCEPTABLE_RESOLVED.has((task.resolved_status ?? "").toString()) &&
    !task.auto_clear_forbidden
  );
}

/**
 * Validate then produce the durable patch for the task row. Returns an error
 * envelope on rule violation so the caller maps it to an HTTP status.
 * reset_review returns the task to a pristine unreviewed state (clears
 * note/reason/reviewer); the reset itself is captured by the audit row.
 */
export function applyCommitteeTaskReview(
  task: ReviewableTask,
  action: CommitteeReviewAction,
  opts: CommitteeReviewOpts = {},
): { ok: true; patch: CommitteeReviewPatch } | (ReviewValidation & { ok: false }) {
  const validation = validateCommitteeTaskReview(task, action, opts);
  if (!validation.ok) return validation;

  const newStatus = mapActionToReviewStatus(action);
  const now = opts.now ?? null;
  const actor = opts.actorId ?? null;

  if (action === "reset_review") {
    return {
      ok: true,
      patch: {
        review_status: "unreviewed",
        review_note: null,
        review_reason: null,
        reviewed_by: null,
        reviewed_at: null,
        committee_grade_accepted: false,
      },
    };
  }

  // SPEC-…-WORKFLOW-RESOLUTION-1: banker-attested resolutions reuse the
  // free-text columns. The structured outcome lives in review_reason
  // (machine-parseable), the human text in review_note. An "unable_to_verify"
  // screen does NOT resolve (downgrades to needs_more_evidence). Never sets
  // committee_grade_accepted (banker attestation ≠ committee-grade evidence).
  if (action === "record_screening_result") {
    const result = (opts.result ?? "").toString() as ScreeningResult;
    const resolves = result === "clear" || result === "finding";
    return {
      ok: true,
      patch: {
        review_status: resolves ? "banker_attested" : "needs_more_evidence",
        review_note: hasText(opts.note) ? opts.note!.trim() : null,
        review_reason: `screening_result:${result}`,
        reviewed_by: actor,
        reviewed_at: now,
        committee_grade_accepted: false,
      },
    };
  }

  if (action === "submit_analyst_conclusion" || action === "banker_override") {
    return {
      ok: true,
      patch: {
        review_status: "banker_attested",
        review_note: hasText(opts.note) ? opts.note!.trim() : null,
        review_reason:
          action === "banker_override"
            ? (hasText(opts.reason) ? opts.reason!.trim() : "banker_override")
            : "analyst_conclusion",
        reviewed_by: actor,
        reviewed_at: now,
        committee_grade_accepted: false,
      },
    };
  }

  return {
    ok: true,
    patch: {
      review_status: newStatus,
      review_note: hasText(opts.note) ? opts.note!.trim() : null,
      review_reason: hasText(opts.reason) ? opts.reason!.trim() : null,
      reviewed_by: actor,
      reviewed_at: now,
      committee_grade_accepted: canAcceptCommitteeGrade(task, newStatus),
    },
  };
}

export type CommitteeReviewAuditRow = {
  task_id: string;
  mission_id: string;
  deal_id: string;
  action: CommitteeReviewAction;
  previous_review_status: string | null;
  new_review_status: CommitteeReviewStatus;
  note: string | null;
  reason: string | null;
  actor_id: string | null;
};

/**
 * Build the audit row for buddy_research_committee_task_reviews. mission_id /
 * deal_id come from the trusted DB task row (NOT the client). created_at is set
 * by the DB default.
 */
export function buildReviewAuditRow(args: {
  task: ReviewableTask;
  action: CommitteeReviewAction;
  newStatus: CommitteeReviewStatus;
  opts: CommitteeReviewOpts;
}): CommitteeReviewAuditRow {
  const { task, action, newStatus, opts } = args;
  return {
    task_id: task.id,
    mission_id: (task.mission_id ?? "").toString(),
    deal_id: (task.deal_id ?? "").toString(),
    action,
    previous_review_status: task.review_status ?? "unreviewed",
    new_review_status: newStatus,
    note: hasText(opts.note) ? opts.note!.trim() : null,
    reason: hasText(opts.reason) ? opts.reason!.trim() : null,
    actor_id: opts.actorId ?? null,
  };
}
