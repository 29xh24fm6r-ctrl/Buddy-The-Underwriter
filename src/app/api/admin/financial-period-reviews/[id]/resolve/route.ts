/**
 * POST /api/admin/financial-period-reviews/[id]/resolve
 *
 * Resolves a financial statement period review by confirming the statement period.
 * Recomputes checklist_key via resolveChecklistKey and sets finalized_at.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveFinancialStatementPeriod } from "@/lib/documents/resolveFinancialStatementPeriod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let adminUserId: string;
  try {
    const admin = await requireSuperAdmin();
    adminUserId = admin.userId;
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: reviewId } = await params;
  const body = await req.json();

  const { confirmedStatementPeriod, reviewerNote } = body as {
    confirmedStatementPeriod?: string;
    reviewerNote?: string;
  };

  if (!confirmedStatementPeriod) {
    return NextResponse.json({ error: "confirmedStatementPeriod required" }, { status: 400 });
  }

  // Fetch the review row to get document_id and deal_id
  const sb = supabaseAdmin();
  const { data: review, error: fetchErr } = await (sb as any)
    .from("financial_statement_period_reviews")
    .select("id, document_id, deal_id, status")
    .eq("id", reviewId)
    .maybeSingle();

  if (fetchErr || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.status !== "OPEN") {
    return NextResponse.json({ error: `Review already ${review.status}` }, { status: 409 });
  }

  const result = await resolveFinancialStatementPeriod({
    reviewId,
    documentId: review.document_id,
    dealId: review.deal_id,
    reviewerUserId: adminUserId,
    confirmedStatementPeriod: confirmedStatementPeriod as any,
    reviewerNote,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    documentId: review.document_id,
    checklistKey: result.checklistKey,
    finalizedAt: result.finalizedAt,
  });
}
