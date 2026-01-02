// src/app/api/deals/[dealId]/portal/requests/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns borrower document requests for this deal.
 * Includes open + completed so banker can assign to anything.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status,due_at,created_at,updated_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error)
    return NextResponse.json(
      { error: "Failed to load requests" },
      { status: 500 },
    );
  return NextResponse.json({ requests: data || [] });
}
