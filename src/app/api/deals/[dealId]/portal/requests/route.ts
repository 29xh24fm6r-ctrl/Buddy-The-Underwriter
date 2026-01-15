// src/app/api/deals/[dealId]/portal/requests/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

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
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized", requests: [] }, { status: 401 });
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : access.error === "tenant_mismatch" ? 403 : 400;
    return NextResponse.json({ ok: false, error: access.error, requests: [] }, { status });
  }

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status,due_at,created_at,updated_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error)
    return NextResponse.json(
      { ok: false, error: "Failed to load requests", requests: [] },
      { status: 500 },
    );
  return NextResponse.json({ ok: true, requests: data || [] });
}
