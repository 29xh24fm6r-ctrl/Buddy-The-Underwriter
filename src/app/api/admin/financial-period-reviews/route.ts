/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-1
 *
 * GET /api/admin/financial-period-reviews
 *   Lists open financial statement period review candidates.
 *   Detects candidates on-the-fly from deal_documents where period is ambiguous.
 *
 * POST /api/admin/financial-period-reviews
 *   Seeds review rows for detected candidates (idempotent — skips existing open reviews).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { needsFinancialPeriodReview, getFinancialPeriodReviewReason } from "@/lib/documents/financialPeriodReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try { await requireSuperAdmin(); } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const dealId = req.nextUrl.searchParams.get("dealId");
  const status = req.nextUrl.searchParams.get("status") ?? "OPEN";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500);

  // Fetch existing review rows
  let query = (sb as any)
    .from("financial_statement_period_reviews")
    .select("*, deal_documents!inner(original_filename, display_name, canonical_type, document_type, doc_year)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (dealId) query = query.eq("deal_id", dealId);

  const { data: existingReviews, error: reviewErr } = await query;

  if (reviewErr) {
    // Table might not have the join — fall back to plain query
    const { data: plainReviews, error: plainErr } = await (sb as any)
      .from("financial_statement_period_reviews")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (plainErr) return NextResponse.json({ error: plainErr.message }, { status: 500 });
    return NextResponse.json({ reviews: plainReviews ?? [] });
  }

  return NextResponse.json({ reviews: existingReviews ?? [] });
}

export async function POST(req: NextRequest) {
  try { await requireSuperAdmin(); } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const dealId = req.nextUrl.searchParams.get("dealId");

  // Find documents needing period review
  let docQuery = (sb as any)
    .from("deal_documents")
    .select("id, deal_id, bank_id, document_type, canonical_type, checklist_key, statement_period, original_filename, display_name")
    .in("canonical_type", ["BALANCE_SHEET", "INCOME_STATEMENT", "FINANCIAL_STATEMENT"])
    .limit(200);

  if (dealId) docQuery = docQuery.eq("deal_id", dealId);

  const { data: docs, error: docsErr } = await docQuery;
  if (docsErr) return NextResponse.json({ error: docsErr.message }, { status: 500 });

  // Filter to candidates that actually need review
  const candidates = ((docs ?? []) as any[]).filter((doc: any) =>
    needsFinancialPeriodReview({
      canonicalType: doc.canonical_type,
      checklistKey: doc.checklist_key,
      statementPeriod: doc.statement_period,
    }),
  );

  // Fetch existing open reviews to avoid duplicates
  const docIds = candidates.map((c: any) => c.id);
  const { data: existingOpen } = await (sb as any)
    .from("financial_statement_period_reviews")
    .select("document_id")
    .in("document_id", docIds.length > 0 ? docIds : ["__none__"])
    .eq("status", "OPEN");

  const existingDocIds = new Set(((existingOpen ?? []) as any[]).map((r: any) => r.document_id));

  // Seed new review rows
  const newRows = candidates
    .filter((c: any) => !existingDocIds.has(c.id))
    .map((c: any) => ({
      deal_id: c.deal_id,
      document_id: c.id,
      bank_id: c.bank_id,
      current_document_type: c.document_type ?? "UNKNOWN",
      current_canonical_type: c.canonical_type ?? "UNKNOWN",
      current_checklist_key: c.checklist_key,
      current_statement_period: c.statement_period,
      review_reason: getFinancialPeriodReviewReason({
        canonicalType: c.canonical_type,
        checklistKey: c.checklist_key,
        statementPeriod: c.statement_period,
      }) ?? "Period ambiguity detected.",
      status: "OPEN",
    }));

  let seeded = 0;
  if (newRows.length > 0) {
    const { error: insertErr } = await (sb as any)
      .from("financial_statement_period_reviews")
      .insert(newRows);
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    seeded = newRows.length;
  }

  return NextResponse.json({
    candidatesFound: candidates.length,
    alreadyOpen: existingDocIds.size,
    seeded,
  });
}
