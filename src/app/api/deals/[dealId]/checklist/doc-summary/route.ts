import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;

    // Tenant enforcement
    const ensured = await ensureDealBankAccess(dealId);
    if (!ensured.ok) {
      const statusCode = 
        ensured.error === "deal_not_found" ? 404 :
        ensured.error === "tenant_mismatch" ? 403 :
        400;
      
      return NextResponse.json(
        { ok: false, error: ensured.error },
        { status: statusCode }
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("deal_documents")
      .select("checklist_key")
      .eq("deal_id", dealId)
      .not("checklist_key", "is", null);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const counts: Record<string, number> = {};
    for (const r of data || []) {
      const k = String((r as any).checklist_key || "");
      if (!k) continue;
      counts[k] = (counts[k] || 0) + 1;
    }

    return NextResponse.json({ ok: true, counts });
  } catch (e: any) {
    console.error("[checklist/doc-summary]", e);
    return NextResponse.json({ ok: false, error: e?.message || "Failed" }, { status: 500 });
  }
}
