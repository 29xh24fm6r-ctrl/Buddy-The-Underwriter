import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
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

    const sb = supabaseAdmin();
    const { data: decision, error } = await sb
      .from("financial_snapshot_decisions")
      .select(
        "id, financial_snapshot_id, deal_id, bank_id, inputs_json, stress_json, sba_json, narrative_json, created_at",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!decision) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const { data: snapshot } = await sb
      .from("financial_snapshots")
      .select("id, as_of_timestamp, snapshot_hash, created_at")
      .eq("id", decision.financial_snapshot_id)
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      dealId,
      decision,
      snapshot,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/financial-snapshot/decision]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
