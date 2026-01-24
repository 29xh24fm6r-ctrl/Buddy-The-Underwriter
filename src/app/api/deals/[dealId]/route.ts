import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "Missing dealId" },
        { status: 400 },
      );
    }

    const supabase = supabaseAdmin();

    // Load deal with bank info (bank_id guaranteed by FK constraint)
    const { data: deal, error } = await supabase
      .from("deals")
      .select(
        `
        *,
        bank:banks(id, code, name)
      `,
      )
      .eq("id", dealId)
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "deals_select_failed", details: error.message },
        { status: 500 },
      );
    }

    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, deal });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "deal_get_failed",
        details: e?.message || "unknown_error",
      },
      { status: 500 },
    );
  }
}
