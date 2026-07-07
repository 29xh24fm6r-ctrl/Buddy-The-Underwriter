import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";
// route-class: CLERK (SPEC-SEC-1)

/**
 * GET /api/deals/[dealId]/messages
 *
 * Returns messages for a deal, optionally filtered by status
 * Query params: ?status=DRAFT
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // SPEC-SEC-1: enforce Clerk auth + bank-tenant access before reading the
    // borrower conversation (cross-tenant read otherwise).
    await assertDealAccess(dealId);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const supabase = supabaseAdmin();

    let query = supabase
      .from("condition_messages")
      .select("*")
      .eq("application_id", dealId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, messages: data ?? [] });
  } catch (err: any) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
