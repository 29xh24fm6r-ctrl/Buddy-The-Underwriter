import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/admin/deals/[dealId]/checklist/list?token=...
 *
 * Token-protected admin helper to fetch checklist items without Clerk cookies.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
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

  const { data: items, error } = await sb
    .from("deal_checklist_items")
    .select(
      "id, deal_id, checklist_key, title, description, required, status, received_at, satisfied_at, required_years, satisfied_years, created_at, updated_at",
    )
    .eq("deal_id", dealId)
    .order("checklist_key", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const safeItems = (items ?? []).map((row: any) => ({
    ...row,
    status: row.status ? String(row.status).toLowerCase() : "missing",
  }));

  const counts = {
    total: safeItems.length,
    received: safeItems.filter((i: any) => i.status === "received" || i.status === "satisfied").length,
    pending: safeItems.filter((i: any) => i.status === "pending" || i.status === "missing" || !i.status).length,
    optional: safeItems.filter((i: any) => i.required === false).length,
  };

  return NextResponse.json({
    ok: true,
    dealId,
    counts,
    items: safeItems,
    server_ts: new Date().toISOString(),
  });
}
