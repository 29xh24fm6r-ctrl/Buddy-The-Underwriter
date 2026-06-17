/**
 * BUGFIX-CLASSIC-SPREAD-BORROWER-REQUESTED-STILL-OPEN-1 — single source of truth for which review
 * action statuses are still ACTIVE (open / actionable / blocking) vs reviewed-and-settled.
 *
 * `borrower_detail_requested` is ACTIVE: a borrower request has been created but no source support has
 * been uploaded/consumed yet, so the source-detail blocker is NOT resolved. It must keep counting as
 * open and keep blocking the spread/certification until the audit finding disappears after upload +
 * regenerate/sync (at which point reviewActionsRepo prune closes the row).
 *
 * Pure constant + predicate, no imports — safe to import from client components and server code alike.
 */

export const ACTIVE_REVIEW_ACTION_STATUSES = ["open", "borrower_detail_requested"] as const;

/** True when the action is still open/actionable/blocking (not reviewed/resolved/waived/closed). */
export function isActiveReviewActionStatus(status: string | null | undefined): boolean {
  return status === "open" || status === "borrower_detail_requested";
}
