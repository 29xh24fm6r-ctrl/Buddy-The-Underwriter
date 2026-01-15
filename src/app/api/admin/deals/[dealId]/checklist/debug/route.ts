// src/app/api/admin/deals/[dealId]/checklist/debug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const dynamic = "force-dynamic";

/**
 * 🔥 ADMIN DEBUG ENDPOINT - No Clerk auth required
 * 
 * This endpoint uses service-role Supabase to prove checklist rows exist
 * without needing browser cookies. Protected by ADMIN_DEBUG_TOKEN env var.
 * 
 * Usage:
 *   curl -sS "$APP_URL/api/admin/deals/$DEAL_ID/checklist/debug?token=$ADMIN_DEBUG_TOKEN" | jq
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  const url = new URL(req.url);

  // Allow either Clerk super-admin OR an explicit debug token (for terminal debugging).
  let isSuperAdmin = false;
  try {
    await requireSuperAdmin();
    isSuperAdmin = true;
  } catch {
    isSuperAdmin = false;
  }
  if (!isSuperAdmin) {
    const token = url.searchParams.get("token") || "";
    const expected = process.env.ADMIN_DEBUG_TOKEN || "";
    if (!expected || token !== expected) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_checklist_items")
    .select(
      `
      id,
      deal_id,
      checklist_key,
      title,
      description,
      required,
      status,
      requested_at,
      received_at,
      created_at,
      updated_at
    `
    )
    .eq("deal_id", dealId)
    .order("checklist_key", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    dealId,
    count: (data ?? []).length,
    items: data ?? [],
    server_ts: new Date().toISOString(),
  });
}
