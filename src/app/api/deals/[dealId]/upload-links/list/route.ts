import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

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
    .from("deal_upload_links")
    .select(
      "id, deal_id, created_at, expires_at, revoked_at, single_use, used_at, require_password, label",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, links: data ?? [] });
}
