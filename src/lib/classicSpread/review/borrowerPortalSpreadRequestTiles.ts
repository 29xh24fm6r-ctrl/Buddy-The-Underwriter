/**
 * SPEC-BORROWER-PORTAL-SPREAD-REQUEST-TILES-1 — pure projection of classic-spread source-detail
 * borrower requests (draft_borrower_requests) into borrower-portal upload tiles.
 *
 * Reads ONLY the structured request package already written by SPEC-BORROWER-EVIDENCE-REQUEST-
 * PACKAGE-POLISH-1 (the draft's evidence jsonb) plus the live review-action status. The tile therefore
 * shows exactly what was requested (evidence kind, period, clearing target, plain-English instruction)
 * and carries the exact linkage the commit route forwards so the upload becomes LINKED evidence.
 *
 * Honest lifecycle (never shortcut):
 *   - rendering a tile does not clear; the tile only INVITES an upload;
 *   - a tile renders ONLY while a matching review action is still ACTIVE (open / borrower_detail_
 *     requested). Once the action is closed / settled (banker decision, or system-pruned after a
 *     regenerate whose audit no longer emits the finding) the tile disappears — the close-loop lives
 *     entirely in the review-action status, never in upload/extraction/request metadata.
 *
 * Pure: no IO, no DB, no math, no source-line inference. Banker-internal copy is never surfaced.
 */
import { isActiveReviewActionStatus } from "./reviewActionStatus";

/** evidence[].source token written by ensureBorrowerSourceDetailRequest for spread source-detail drafts. */
export const SPREAD_SOURCE_DETAIL_EVIDENCE_SOURCE = "classic_spread_source_detail";

/** Draft statuses that are still live/eligible to surface to the borrower (mirrors ensure's ACTIVE set). */
const ACTIVE_DRAFT_STATUSES = ["pending_approval", "approved", "sent"];

export type SpreadRequestDraftRow = {
  id: string;
  status: string | null;
  missing_document_type?: string | null;
  draft_subject?: string | null;
  draft_message?: string | null;
  evidence?: unknown;
};

export type SpreadRequestActionStatus = {
  id: string;
  finding_key: string;
  status: string;
};

export type BorrowerSpreadRequestTile = {
  /** stable id for the portal list (the draft row id) */
  id: string;
  draftBorrowerRequestId: string;
  title: string;
  /** plain-English borrower instruction (draft_message) */
  description: string;
  requestedEvidenceKind: string | null;
  requestedPeriod: string | null;
  clearingTarget: string | null;
  statementType: string | null;
  lineItem: string | null;
  acceptableDocuments: string[];
  unacceptableDocuments: string[];
  spreadReviewActionId: string | null;
  spreadFindingKey: string | null;
  /** true when structured upload context is present → an upload becomes EXACT linked evidence (not a
   *  bare informational request). When false the tile is informational/fallback only. */
  hasUploadContext: boolean;
};

type SpreadEvidenceObj = Record<string, any>;

function spreadEvidenceOf(evidence: unknown): SpreadEvidenceObj | null {
  const arr = Array.isArray(evidence) ? evidence : evidence != null ? [evidence] : [];
  return arr.find((e: any) => e && e.source === SPREAD_SOURCE_DETAIL_EVIDENCE_SOURCE) ?? null;
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

const cleanStr = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

/**
 * SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1: a borrower must never see a blank tile. When the
 * draft carries no plain-English message (legacy/partial draft), synthesize a conservative, borrower-
 * safe instruction from the structured request fields. Never references banker-internal copy.
 */
function safeBorrowerInstruction(args: {
  evidenceKind: string | null;
  period: string | null;
  clearingTarget: string | null;
  acceptable: string[];
}): string {
  const { evidenceKind, period, clearingTarget, acceptable } = args;
  if (clearingTarget) {
    return `Your lending team needs supporting documentation${period ? ` as of ${period}` : ""} showing ${clearingTarget}.`;
  }
  if (acceptable.length > 0) {
    return `Please upload supporting documentation${period ? ` as of ${period}` : ""}. Examples that work: ${acceptable.slice(0, 3).join("; ")}.`;
  }
  const kindLabel = evidenceKind ? evidenceKind.replace(/_/g, " ") : "supporting documentation";
  return `Your lending team requested ${kindLabel}${period ? ` as of ${period}` : ""} to finish your financial spread.`;
}

/** True when the draft is a classic-spread source-detail request (others are unrelated → never a tile). */
export function isSpreadSourceDetailDraft(row: SpreadRequestDraftRow): boolean {
  return spreadEvidenceOf(row.evidence) != null;
}

/**
 * Project active spread source-detail drafts into borrower upload tiles. A draft yields a tile only
 * when (a) it is a spread source-detail draft, (b) its draft status is still active, and (c) a matching
 * review action is still active. The review action is the AUTHORITY on resolution — a closed/settled/
 * pruned action means the blocker is gone and the tile must not render.
 */
export function buildBorrowerSpreadRequestTiles(args: {
  drafts: SpreadRequestDraftRow[];
  actions: SpreadRequestActionStatus[];
}): BorrowerSpreadRequestTile[] {
  const actionById = new Map<string, SpreadRequestActionStatus>();
  const actionByFinding = new Map<string, SpreadRequestActionStatus>();
  for (const a of args.actions ?? []) {
    if (a?.id) actionById.set(a.id, a);
    if (a?.finding_key) actionByFinding.set(a.finding_key, a);
  }

  const tiles: BorrowerSpreadRequestTile[] = [];
  for (const draft of args.drafts ?? []) {
    const ev = spreadEvidenceOf(draft.evidence);
    if (!ev) continue; // not a spread source-detail draft → preserve unrelated-draft behavior
    if (!ACTIVE_DRAFT_STATUSES.includes(String(draft.status ?? ""))) continue;

    const reviewActionId = cleanStr(ev.source_review_action_id);
    const findingKey = cleanStr(ev.source_finding_key);

    // SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1: a tile is only fulfillable if the upload it
    // invites can be tied back to a review action — i.e. the draft carries at least one forwardable
    // linkage key (review-action id or finding key). A malformed/partial draft with neither must never
    // render a broken upload tile (the upload could not become LINKED evidence). Degrade silently.
    if (!reviewActionId && !findingKey) continue;

    // The review action governs whether the request is still unresolved. Match by id first (stable row
    // id) then by finding_key (stable across re-sync). No active match ⇒ the blocker is gone ⇒ no tile.
    const action =
      (reviewActionId ? actionById.get(reviewActionId) : undefined) ||
      (findingKey ? actionByFinding.get(findingKey) : undefined) ||
      null;
    if (!action || !isActiveReviewActionStatus(action.status)) continue;

    const requestedEvidenceKind = cleanStr(ev.requested_evidence_kind);
    const requestedPeriod = cleanStr(ev.requested_period) ?? cleanStr(ev.requested_period_end);
    const clearingTarget = cleanStr(ev.clearing_target);
    const acceptableDocuments = strArray(ev.acceptable_documents);

    tiles.push({
      id: draft.id,
      draftBorrowerRequestId: draft.id,
      title: cleanStr(draft.draft_subject) ?? "Additional document requested",
      // Never blank: fall back to a conservative, borrower-safe instruction built from structured fields.
      description:
        cleanStr(draft.draft_message) ??
        safeBorrowerInstruction({ evidenceKind: requestedEvidenceKind, period: requestedPeriod, clearingTarget, acceptable: acceptableDocuments }),
      requestedEvidenceKind,
      requestedPeriod,
      clearingTarget,
      statementType: cleanStr(ev.statement_type),
      lineItem: cleanStr(ev.line_item),
      acceptableDocuments,
      unacceptableDocuments: strArray(ev.unacceptable_documents),
      spreadReviewActionId: reviewActionId,
      spreadFindingKey: findingKey,
      // Structured context present ⇒ an upload becomes exact linked evidence. The linkage forwarded by
      // the tile (action id / finding key / draft id) is what makes the upload LINKED, not this flag.
      hasUploadContext: Boolean(requestedEvidenceKind),
    });
  }
  return tiles;
}
