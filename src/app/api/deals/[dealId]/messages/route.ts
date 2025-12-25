import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  await requireRole(["underwriter", "bank_admin", "super_admin"]);
  const { dealId } = await ctx.params;
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
}
