/**
 * Financial Statement Period Resolution — Server-side resolver
 *
 * Applies a reviewer's period confirmation to a document:
 * 1. Updates deal_documents: statement_period, checklist_key, finalized_at
 * 2. Marks the review row as RESOLVED
 * 3. Emits a ledger event for audit trail
 *
 * Uses resolveChecklistKey as the single source of truth for checklist_key.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";
import { writeEvent } from "@/lib/ledger/writeEvent";

export type ResolveFinancialPeriodInput = {
  reviewId: string;
  documentId: string;
  dealId: string;
  reviewerUserId: string;
  confirmedStatementPeriod: "CURRENT" | "HISTORICAL" | "YTD" | "ANNUAL" | "INTERIM" | "FYE";
  reviewerNote?: string | null;
};

export type ResolveFinancialPeriodResult =
  | { ok: true; checklistKey: string | null; finalizedAt: string }
  | { ok: false; error: string };

const VALID_PERIODS = new Set(["CURRENT", "HISTORICAL", "YTD", "ANNUAL", "INTERIM", "FYE"]);

export async function resolveFinancialStatementPeriod(
  input: ResolveFinancialPeriodInput,
): Promise<ResolveFinancialPeriodResult> {
  if (!VALID_PERIODS.has(input.confirmedStatementPeriod)) {
    return { ok: false, error: `Invalid period: ${input.confirmedStatementPeriod}` };
  }

  const sb = supabaseAdmin();

  // 1. Fetch current document state
  const { data: doc, error: docErr } = await (sb as any)
    .from("deal_documents")
    .select("id, deal_id, canonical_type, document_type, checklist_key, statement_period, doc_year, finalized_at")
    .eq("id", input.documentId)
    .eq("deal_id", input.dealId)
    .maybeSingle();

  if (docErr || !doc) {
    return { ok: false, error: docErr?.message ?? "Document not found" };
  }

  const canonicalType = String(doc.canonical_type ?? "");
  const docYear = doc.doc_year ?? null;
  const previousChecklistKey = doc.checklist_key ?? null;
  const previousStatementPeriod = doc.statement_period ?? null;

  // 2. Compute new checklist_key via resolveChecklistKey (single source of truth)
  const newChecklistKey = resolveChecklistKey(
    canonicalType,
    docYear,
    input.confirmedStatementPeriod,
  );

  // 3. Determine reviewer_decision code
  let reviewerDecision: string;
  if (canonicalType === "BALANCE_SHEET") {
    reviewerDecision = input.confirmedStatementPeriod === "CURRENT"
      ? "CONFIRM_CURRENT_BS" : "CONFIRM_HISTORICAL_BS";
  } else if (canonicalType === "INCOME_STATEMENT") {
    reviewerDecision = input.confirmedStatementPeriod === "YTD"
      ? "CONFIRM_YTD_IS" : "CONFIRM_ANNUAL_IS";
  } else {
    reviewerDecision = "CONFIRM_GENERIC_FS";
  }

  const now = new Date().toISOString();

  // 4. Update deal_documents
  const { error: updateErr } = await (sb as any)
    .from("deal_documents")
    .update({
      statement_period: input.confirmedStatementPeriod,
      ...(newChecklistKey ? { checklist_key: newChecklistKey } : {}),
      finalized_at: now,
      updated_at: now,
    })
    .eq("id", input.documentId);

  if (updateErr) {
    return { ok: false, error: `Document update failed: ${updateErr.message}` };
  }

  // 5. Mark review row RESOLVED
  await (sb as any)
    .from("financial_statement_period_reviews")
    .update({
      status: "RESOLVED",
      reviewer_user_id: input.reviewerUserId,
      reviewer_decision: reviewerDecision,
      confirmed_statement_period: input.confirmedStatementPeriod,
      confirmed_checklist_key: newChecklistKey,
      reviewer_note: input.reviewerNote ?? null,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", input.reviewId);

  // 6. Emit ledger event for audit trail
  await writeEvent({
    dealId: input.dealId,
    kind: "document.period_review.resolved",
    actorUserId: input.reviewerUserId,
    input: {
      document_id: input.documentId,
      review_id: input.reviewId,
      canonical_type: canonicalType,
      previous_checklist_key: previousChecklistKey,
      previous_statement_period: previousStatementPeriod,
      confirmed_statement_period: input.confirmedStatementPeriod,
      confirmed_checklist_key: newChecklistKey,
      reviewer_decision: reviewerDecision,
      reviewer_note: input.reviewerNote ?? null,
    },
  });

  return { ok: true, checklistKey: newChecklistKey, finalizedAt: now };
}

/**
 * Mark a review as NOT_APPLICABLE (document doesn't need period resolution).
 */
export async function markPeriodReviewNotApplicable(args: {
  reviewId: string;
  dealId: string;
  documentId: string;
  reviewerUserId: string;
  reviewerNote?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await (sb as any)
    .from("financial_statement_period_reviews")
    .update({
      status: "NOT_APPLICABLE",
      reviewer_user_id: args.reviewerUserId,
      reviewer_decision: "NOT_APPLICABLE",
      reviewer_note: args.reviewerNote ?? null,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", args.reviewId);

  if (error) return { ok: false, error: error.message };

  await writeEvent({
    dealId: args.dealId,
    kind: "document.period_review.not_applicable",
    actorUserId: args.reviewerUserId,
    input: {
      document_id: args.documentId,
      review_id: args.reviewId,
      reviewer_note: args.reviewerNote ?? null,
    },
  });

  return { ok: true };
}
