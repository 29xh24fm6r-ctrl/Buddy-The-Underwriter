/**
 * POST /api/admin/financial-period-reviews/[id]/not-applicable
 *
 * Marks a financial statement period review as NOT_APPLICABLE.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { markPeriodReviewNotApplicable } from "@/lib/documents/resolveFinancialStatementPeriod";

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
  const { reviewerNote } = body as { reviewerNote?: string };

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

  const result = await markPeriodReviewNotApplicable({
    reviewId,
    dealId: review.deal_id,
    documentId: review.document_id,
    reviewerUserId: adminUserId,
    reviewerNote,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
