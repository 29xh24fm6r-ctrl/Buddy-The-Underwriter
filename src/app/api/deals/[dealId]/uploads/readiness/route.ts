import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const expectedRaw = url.searchParams.get("expected");
    const expected = expectedRaw ? Math.max(0, parseInt(expectedRaw, 10) || 0) : null;

    const { count, error } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);

    if (error) throw error;

    const persisted = count ?? 0;
    const exp = expected ?? persisted; // if client doesn't pass expected, assume ready
    const remaining = Math.max(0, exp - persisted);
    const ready = remaining === 0;

    return NextResponse.json({
      ok: true,
      dealId,
      bankId,
      expected: exp,
      persisted,
      remaining,
      ready,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Internal server error", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
