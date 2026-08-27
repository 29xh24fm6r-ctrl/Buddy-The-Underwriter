import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccessAllowingBrokerageStaff } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

function emptyProgress(dealId: string, error: string) {
  return {
    ok: false,
    error,
    dealId,
    confirmed_docs: 0,
    total_docs: 0,
    received_count: 0,
    total_checklist: 0,
    docs: { total: 0, confirmed: 0 },
    checklist: { required: 0, received_required: 0 },
  };
}

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    const access = await withTimeout(
      ensureDealBankAccessAllowingBrokerageStaff(dealId),
      8_000,
      "dealAccess",
    );
    if (!access.ok) {
      const status =
        access.error === "unauthorized"
          ? 401
          : access.error === "deal_not_found"
            ? 404
            : 403;
      return NextResponse.json(emptyProgress(dealId, access.error), { status });
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
    const requiredItems = (checklist ?? []).filter((item: any) => item.required).length;
    const receivedRequired = (checklist ?? []).filter(
      (item: any) => item.required && item.received_at,
    ).length;

    return NextResponse.json({
      ok: true,
      dealId,
      confirmed_docs: confirmedDocs,
      total_docs: totalDocs,
      received_count: receivedRequired,
      total_checklist: requiredItems,
      docs: { total: totalDocs, confirmed: confirmedDocs },
      checklist: { required: requiredItems, received_required: receivedRequired },
    });
  } catch (error: any) {
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[/api/deals/[dealId]/progress]", error);
    return NextResponse.json(
      emptyProgress((await ctx.params).dealId, isTimeout ? "Request timed out" : "Failed to fetch progress"),
      { status: isTimeout ? 504 : 500 },
    );
  }
}
