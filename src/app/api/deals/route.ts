import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const bankId = await getCurrentBankId();
    const body = await req.json().catch(() => ({}) as any);
    const name = String(body?.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_name" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServerClient();
    const dealId = crypto.randomUUID();

    const { data: deal, error } = await supabase
      .from("deals")
      .insert({
        id: dealId,
        name,
        bank_id: bankId,
        stage: "intake",
        borrower_name: name,
        entity_type: "Unknown",
        risk_score: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, dealId: deal.id }, { status: 201 });
  } catch (err: any) {
    if (err?.message?.includes("bank_not_selected")) {
      return NextResponse.json(
        { ok: false, error: "bank_not_selected" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
