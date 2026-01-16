import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const typesRaw = url.searchParams.get("types") ?? "";
    const types = typesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const sb = supabaseAdmin();
    let q = (sb as any)
      .from("deal_spreads")
      .select("deal_id, bank_id, spread_type, spread_version, status, rendered_json, updated_at, error")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);

    if (types.length) {
      q = q.in("spread_type", types);
    }

    const { data, error } = await q.order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, dealId, spreads: data ?? [] });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
