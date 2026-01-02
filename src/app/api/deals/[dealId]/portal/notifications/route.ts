// src/app/api/deals/[dealId]/portal/notifications/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_notifications")
    .select("id,title,body,created_at,status")
    .eq("deal_id", dealId)
    .eq("audience", "bank")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error)
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 },
    );
  return NextResponse.json({ notifications: data || [] });
}
