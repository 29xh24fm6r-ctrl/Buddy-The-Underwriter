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
import { needsFinancialPeriodReview } from "@/lib/documents/financialPeriodReview";
import { enqueueFinancialPeriodReviewIfNeeded } from "@/lib/documents/enqueueFinancialPeriodReview";

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

  // Seed via the shared enqueue path so the admin tool and the automatic
  // classify-path enqueue share one rule + idempotency guard.
  let seeded = 0;
  let alreadyOpen = 0;
  for (const c of candidates as any[]) {
    const res = await enqueueFinancialPeriodReviewIfNeeded(
      {
        dealId: c.deal_id,
        documentId: c.id,
        bankId: c.bank_id ?? null,
        documentType: c.document_type ?? null,
        canonicalType: c.canonical_type ?? null,
        checklistKey: c.checklist_key ?? null,
        statementPeriod: c.statement_period ?? null,
      },
      sb,
    );
    if (res.enqueued) seeded++;
    else if (res.skipped === "already_open") alreadyOpen++;
  }

  return NextResponse.json({
    candidatesFound: candidates.length,
    alreadyOpen,
    seeded,
  });
}
