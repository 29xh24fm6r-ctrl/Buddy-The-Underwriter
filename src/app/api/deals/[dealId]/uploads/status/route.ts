import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/uploads/status
 * Back-compat alias for older UI pollers.
 * Never throws red — returns calm defaults when unknown.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // If you have a canonical uploads table/view, swap this query.
    // For now: infer "uploads processing" from very recent pipeline activity.
    const { data: latest } = await sb
      .from("deal_pipeline_ledger")
      .select("created_at, stage, status")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const createdAt = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
    const isRecent = createdAt && Date.now() - createdAt < 30_000;

    const uploadsProcessingCount =
      isRecent && (latest?.stage === "upload" || latest?.stage === "auto_seed") ? 1 : 0;

    return NextResponse.json({
      ok: true,
      uploadsProcessingCount,
      latest: latest ?? null,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      uploadsProcessingCount: 0,
      latest: null,
    });
  }
}
