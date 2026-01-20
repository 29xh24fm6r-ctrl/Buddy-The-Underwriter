import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const buildResponse = (status: number, payload: Record<string, unknown>) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function GET(req: Request, ctx: Ctx) {
  mustBuilderToken(req);

  const { dealId } = await ctx.params;
  if (!dealId) {
    return buildResponse(400, { ok: false, error: "missing_deal_id" });
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal?.bank_id) {
    return buildResponse(404, { ok: false, error: "deal_not_found" });
  }

  const { data: latestVerify } = await sb
    .from("deal_pipeline_ledger")
    .select("created_at, meta")
    .eq("deal_id", dealId)
    .eq("bank_id", deal.bank_id)
    .eq("event_key", "deal.underwrite.verify")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recentEvents } = await sb
    .from("deal_pipeline_ledger")
    .select("event_key, ui_message, ui_state, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", deal.bank_id)
    .order("created_at", { ascending: false })
    .limit(10);

  return buildResponse(200, {
    ok: true,
    dealId,
    bankId: deal.bank_id,
    verify: latestVerify
      ? { ...(latestVerify.meta as any), createdAt: latestVerify.created_at }
      : null,
    events: recentEvents ?? [],
  });
}
