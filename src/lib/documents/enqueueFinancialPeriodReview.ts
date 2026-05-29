/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-ENQUEUE-1
 *
 * Reusable server-side enqueue for financial statement period reviews.
 *
 * The pure detection logic lives in `financialPeriodReview.ts`
 * (`getFinancialPeriodReviewReason`). This module is the single DB-writing path
 * that turns a "needs review" verdict into an OPEN
 * `financial_statement_period_reviews` row. It is called from BOTH the normal
 * classification path (classifyProcessor) and the admin seed endpoint, so the
 * enqueue rule lives in exactly one place.
 *
 * Guarantees:
 * - Only enqueues when the document genuinely needs period review
 *   (financial statement with a missing / generic / unresolved checklist_key).
 * - Idempotent: never creates a second OPEN review for the same document.
 *   App-level pre-check + the DB partial unique index
 *   `idx_period_reviews_open_per_doc (document_id) WHERE status='OPEN'` (which
 *   raises 23505 on a race) both enforce this.
 * - Non-fatal: never throws; callers in the pipeline treat it as best-effort.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFinancialPeriodReviewReason } from "./financialPeriodReview";

export type EnqueuePeriodReviewArgs = {
  dealId: string;
  documentId: string;
  bankId: string | null;
  documentType: string | null;
  canonicalType: string | null;
  checklistKey: string | null;
  statementPeriod: string | null;
};

export type EnqueuePeriodReviewResult =
  | { enqueued: true; reviewId: string; reason: string }
  | { enqueued: false; skipped: "not_needed" | "already_open" | "missing_bank" | "error"; reason?: string };

export async function enqueueFinancialPeriodReviewIfNeeded(
  args: EnqueuePeriodReviewArgs,
  sb?: ReturnType<typeof supabaseAdmin>,
): Promise<EnqueuePeriodReviewResult> {
  const client: any = sb ?? supabaseAdmin();
  try {
    // 1. Decision gate — only financial statements with an unresolved period.
    const reason = getFinancialPeriodReviewReason({
      canonicalType: args.canonicalType,
      checklistKey: args.checklistKey,
      statementPeriod: args.statementPeriod,
    });
    if (!reason) return { enqueued: false, skipped: "not_needed" };

    // bank_id is NOT NULL in the table — cannot enqueue without it.
    if (!args.bankId) return { enqueued: false, skipped: "missing_bank", reason };

    // 2. Idempotency pre-check — one OPEN review per document.
    const { data: existing } = await client
      .from("financial_statement_period_reviews")
      .select("id")
      .eq("document_id", args.documentId)
      .eq("status", "OPEN")
      .maybeSingle();
    if (existing?.id) return { enqueued: false, skipped: "already_open", reason };

    // 3. Insert the OPEN review.
    const { data: inserted, error } = await client
      .from("financial_statement_period_reviews")
      .insert({
        deal_id: args.dealId,
        document_id: args.documentId,
        bank_id: args.bankId,
        current_document_type: args.documentType ?? "UNKNOWN",
        current_canonical_type: args.canonicalType ?? "UNKNOWN",
        current_checklist_key: args.checklistKey,
        current_statement_period: args.statementPeriod,
        review_reason: reason,
        status: "OPEN",
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique_violation on idx_period_reviews_open_per_doc — a concurrent
      // enqueue already created the OPEN review. Treat as idempotent success.
      if (String((error as any).code) === "23505") {
        return { enqueued: false, skipped: "already_open", reason };
      }
      console.warn("[enqueueFinancialPeriodReview] insert failed (non-fatal)", error.message);
      return { enqueued: false, skipped: "error", reason };
    }

    return { enqueued: true, reviewId: inserted.id as string, reason };
  } catch (err: any) {
    console.warn("[enqueueFinancialPeriodReview] threw (non-fatal)", err?.message);
    return { enqueued: false, skipped: "error" };
  }
}
