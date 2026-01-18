import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { makeShadowBrainKey } from "@/buddy/brain/shadowBrainKey";
import { geminiShadowAnalyze } from "@/buddy/brain/geminiAdapter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();
  const bankId = await getCurrentBankId().catch(() => null);

  const body = await req.json().catch(() => null);
  if (!body?.ctx) {
    return NextResponse.json({ ok: false, error: "missing ctx" }, { status: 400 });
  }

  const ctx = body.ctx;
  const requestKey = makeShadowBrainKey({
    role: ctx.role,
    path: ctx.path,
    dealId: ctx.dealId ?? null,
    checklist: ctx.checklist ?? null,
  });

  await sb.from("buddy_shadow_brain_results").upsert(
    {
      bank_id: bankId,
      deal_id: ctx.dealId ?? null,
      request_key: requestKey,
      status: "pending",
    },
    { onConflict: "request_key" }
  );

  (async () => {
    try {
      const out = await geminiShadowAnalyze(ctx);
      await sb
        .from("buddy_shadow_brain_results")
        .update({
          status: "ready",
          model: out.model,
          latency_ms: out.latencyMs,
          result_json: out.resultJson,
          error_text: null,
        })
        .eq("request_key", requestKey);
    } catch (e: any) {
      await sb
        .from("buddy_shadow_brain_results")
        .update({
          status: "error",
          error_text: String(e?.message ?? e),
        })
        .eq("request_key", requestKey);
    }
  })();

  return NextResponse.json({ ok: true, requestKey });
}
