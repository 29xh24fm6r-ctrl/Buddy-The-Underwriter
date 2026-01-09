import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "edge";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
          dealId,
          docs: { total: 0, confirmed: 0 },
          checklist: { required: 0, received_required: 0 },
        },
        { status: 401 },
      );
    }

    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");

    // Tenant enforcement (avoid leaking deal existence across banks)
    const { data: deal, error: dealErr } = await withTimeout(
      sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
      8_000,
      "dealLookup",
    );
    if (dealErr || !deal || deal.bank_id !== bankId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Deal not found",
          dealId,
          docs: { total: 0, confirmed: 0 },
          checklist: { required: 0, received_required: 0 },
        },
        { status: 404 },
      );
    }

    const { data: uploads } = await withTimeout(
      sb.from("deal_uploads").select("status").eq("deal_id", dealId),
      10_000,
      "uploads",
    );

    const { data: checklist } = await withTimeout(
      sb.from("deal_checklist_items").select("received_at, required").eq("deal_id", dealId),
      10_000,
      "checklist",
    );

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
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[/api/deals/[dealId]/progress]", error);
    return NextResponse.json({
      ok: false,
      error: isTimeout ? "Request timed out" : "Failed to fetch progress",
      dealId: (await ctx.params).dealId,
      docs: { total: 0, confirmed: 0 },
      checklist: { required: 0, received_required: 0 },
    }, { status: isTimeout ? 504 : 500 });
  }
}
