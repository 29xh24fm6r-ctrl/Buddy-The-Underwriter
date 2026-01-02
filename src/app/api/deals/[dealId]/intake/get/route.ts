import { NextRequest, NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;
  const { data, error } = await supabaseAdmin()
    .from("deal_intake")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  // If not present, return defaults (client can upsert)
  return NextResponse.json({
    ok: true,
    intake: data ?? {
      deal_id: dealId,
      loan_type: "CRE",
      sba_program: null,
      borrower_name: null,
      borrower_email: null,
      borrower_phone: null,
    },
  });
}
