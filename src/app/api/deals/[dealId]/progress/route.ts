import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const { data: uploads } = await sb
      .from("deal_uploads")
      .select("status")
      .eq("deal_id", dealId);

    const { data: checklist } = await sb
      .from("deal_checklist_items")
      .select("received_at, required")
      .eq("deal_id", dealId);

    const totalDocs = uploads?.length ?? 0;
    const confirmedDocs = (uploads ?? []).filter((u: any) => u.status === "confirmed").length;

    const requiredItems = (checklist ?? []).filter((c: any) => c.required).length;
    const receivedRequired = (checklist ?? []).filter((c: any) => c.required && c.received_at).length;

    return NextResponse.json({
      ok: true,
      dealId,
      docs: { total: totalDocs, confirmed: confirmedDocs },
      checklist: { required: requiredItems, received_required: receivedRequired },
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/progress]", error);
    return NextResponse.json({
      ok: false,
      error: "Failed to fetch progress",
      dealId: (await ctx.params).dealId,
      docs: { total: 0, confirmed: 0 },
      checklist: { required: 0, received_required: 0 },
    });
  }
}
