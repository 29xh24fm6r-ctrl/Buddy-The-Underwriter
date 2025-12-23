import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runUploadIntel } from "@/lib/intel/run-upload-intel";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: { dealId: string } }) {
  try {
    const dealId = String(ctx.params.dealId);
    const sb = supabaseAdmin();

    const up = await sb
      .from("borrower_uploads")
      .select("id, created_at, created")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (up.error) throw new Error(up.error.message);
    if (!up.data?.id) {
      return NextResponse.json({ ok: false, error: "No uploads found for this deal" }, { status: 404 });
    }

    const out = await runUploadIntel(up.data.id);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Deal intel run failed" }, { status: 500 });
  }
}
