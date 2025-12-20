// src/app/api/deals/[dealId]/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealStatusAndLog, DealStage } from "@/lib/deals/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO: swap this to your real auth (Clerk/session) + assignee check.
// Minimal safe default: require "x-user-id" header AND user is assigned banker via deal_assignees.
async function requireBankerUserIdOrThrow(req: Request, dealId: string): Promise<string> {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_assignees")
    .select("user_id")
    .eq("deal_id", dealId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Not authorized (not a banker/assignee on this deal).");

  return userId;
}

type Body = {
  stage?: DealStage;
  etaDate?: string | null; // YYYY-MM-DD or null
  etaNote?: string | null;
};

export async function PATCH(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const actorUserId = await requireBankerUserIdOrThrow(req, dealId);

    const body = (await req.json()) as Body;

    const saved = await upsertDealStatusAndLog({
      dealId,
      stage: body.stage,
      etaDate: body.etaDate,
      etaNote: body.etaNote,
      actorUserId,
    });

    return NextResponse.json({ ok: true, status: saved });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
