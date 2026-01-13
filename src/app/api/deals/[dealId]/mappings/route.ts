import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .single();

    if (dealErr) throw dealErr;

    if (!deal || deal.bank_id !== bankId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await sb
      .from("deal_doc_mappings")
      .select("id, document_id, checklist_key, doc_year, confidence, status, reason, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        dealId,
        mappings: data ?? [],
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
