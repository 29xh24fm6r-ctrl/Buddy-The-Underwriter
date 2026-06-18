import "server-only";

/**
 * SPEC-CLASSIC-SPREAD-BORROWER-SOURCE-DETAIL-REQUEST-1 — wire a REQUEST_SOURCE_DETAIL review action to
 * the existing borrower document-request surface (`draft_borrower_requests`).
 *
 * Idempotent: a second request for the same open finding_key reuses the existing active draft instead
 * of creating a duplicate. Never closes/resolves/waives the review action — the spread blocker stays
 * open until the borrower uploads support and the spread is regenerated. `client` is injectable for
 * tests; production uses the service-role admin client. Non-fatal by design at the call site: the
 * banker decision must persist even if the draft insert fails.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateBorrowerDraft } from "@/lib/agentWorkflows/contracts/borrowerDraft.contract";
import { buildSourceDetailRequest, type BorrowerSourceDetailRequest, type SourceDetailRequestInput } from "./sourceDetailRequestBuilder";

const TABLE = "draft_borrower_requests";
const ACTIVE_STATUSES = ["pending_approval", "approved", "sent"];

export type EnsureBorrowerSourceDetailResult = {
  request: BorrowerSourceDetailRequest;
  borrowerRequestId: string | null;
  created: boolean;
  alreadyRequested: boolean;
  error?: string;
};

type DraftRow = { id: string; status: string; evidence: unknown };

/** The evidence object linking a draft back to the originating spread review action / finding. */
function evidenceFor(req: BorrowerSourceDetailRequest, dealId: string) {
  return [{
    source: "classic_spread_source_detail",
    source_finding_key: req.findingKey,
    source_review_action_id: req.sourceReviewActionId,
    deal_id: dealId,
    statement_type: req.statementType,
    line_item: req.lineItem,
    requested_period_end: req.requestedPeriodEnd,
    // SPEC-BORROWER-EVIDENCE-REQUEST-PACKAGE-POLISH-1: structured fields the upload form forwards so the
    // upload becomes LINKED evidence (round-trips through deal_documents.metadata).
    requested_evidence_kind: req.requestedEvidenceKind,
    requested_period: req.uploadContext.requestedPeriod,
    clearing_target: req.clearingTarget,
    tie_out_target_amount: req.tieOutTargetAmount,
    missing_amount: req.missingAmount,
    requested_documents: req.requestedDocuments,
    acceptable_documents: req.acceptableDocuments,
    unacceptable_documents: req.unacceptableDocuments,
    banker_internal_note: req.bankerInternalNote,
    tags: req.tags,
    generated_by: "sourceDetailRequestBuilder",
  }];
}

function findExistingDraftId(rows: DraftRow[], findingKey: string | null): string | null {
  if (!findingKey) return null;
  for (const r of rows) {
    const ev = r.evidence;
    const arr = Array.isArray(ev) ? ev : ev != null ? [ev] : [];
    if (arr.some((e: any) => e && e.source_finding_key === findingKey)) return r.id;
  }
  return null;
}

export async function ensureBorrowerSourceDetailRequest(args: {
  dealId: string;
  input: SourceDetailRequestInput;
  client?: any;
}): Promise<EnsureBorrowerSourceDetailResult> {
  const { dealId, input } = args;
  const sb = args.client ?? supabaseAdmin();
  const request = buildSourceDetailRequest(input);

  const draftData = {
    deal_id: dealId,
    missing_document_type: request.missingDocumentType,
    draft_subject: request.title,
    draft_message: request.borrowerMessage,
    evidence: evidenceFor(request, dealId),
    status: "pending_approval" as const,
  };

  // Output-contract guard (subject/message/doc-type present, evidence is an array of objects).
  const validation = validateBorrowerDraft(draftData);
  if (!validation.ok && validation.severity === "block") {
    return { request, borrowerRequestId: null, created: false, alreadyRequested: false, error: "draft_contract_block" };
  }

  try {
    // Idempotency: reuse an active draft already tied to this finding_key.
    const { data: existingRows, error: selErr } = await sb
      .from(TABLE)
      .select("id, status, evidence")
      .eq("deal_id", dealId)
      .in("status", ACTIVE_STATUSES);
    if (selErr) throw new Error(selErr.message);

    const existingId = findExistingDraftId((existingRows ?? []) as DraftRow[], request.findingKey);
    if (existingId) {
      // Refresh the copy/evidence in place (amounts/period may have moved) but do NOT duplicate.
      const { error: updErr } = await sb
        .from(TABLE)
        .update({
          missing_document_type: draftData.missing_document_type,
          draft_subject: draftData.draft_subject,
          draft_message: draftData.draft_message,
          evidence: draftData.evidence,
        })
        .eq("id", existingId)
        .eq("deal_id", dealId);
      if (updErr) throw new Error(updErr.message);
      return { request, borrowerRequestId: existingId, created: false, alreadyRequested: true };
    }

    const { data: inserted, error: insErr } = await sb
      .from(TABLE)
      .insert(draftData)
      .select("id")
      .maybeSingle();
    if (insErr) throw new Error(insErr.message);
    return { request, borrowerRequestId: (inserted?.id as string) ?? null, created: true, alreadyRequested: false };
  } catch (err) {
    return {
      request,
      borrowerRequestId: null,
      created: false,
      alreadyRequested: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
