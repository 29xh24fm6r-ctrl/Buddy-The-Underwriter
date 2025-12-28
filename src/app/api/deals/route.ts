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

    // Build insert payload with only fields that should exist
    const insertData: Record<string, any> = {
      id: dealId,
      bank_id: bankId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Add optional fields that may not exist in older schemas
    if (name) {
      insertData.name = name;
      insertData.borrower_name = name; // Use name as fallback for borrower_name
    }
    
    // These may not exist in schema yet
    insertData.stage = "intake";
    insertData.entity_type = "Unknown";
    insertData.risk_score = 0;

    const { data: deal, error } = await supabase
      .from("deals")
      .insert(insertData)
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
