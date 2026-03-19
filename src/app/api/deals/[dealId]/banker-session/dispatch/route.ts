import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";

export const runtime = "nodejs";
export const maxDuration = 15;

const GATEWAY_SECRET = process.env.BUDDY_GATEWAY_SECRET ?? "";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  // Verify gateway secret — this route is called by Fly.io gateway, not browser
  const secret = req.headers.get("x-gateway-secret");
  if (!GATEWAY_SECRET || secret !== GATEWAY_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { dealId } = await props.params;
    const body = await req.json().catch(() => ({}));

    const {
      intent,
      userId,
      bankId,
      sessionId,
      gapId,
      factKey,
      value,
    } = body;

    // Log fact confirmation to deal_events
    const sb = supabaseAdmin();
    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "voice.fact_confirmed",
      payload: {
        actor_user_id: userId,
        scope: "banker_voice_session",
        action: "voice_confirmed",
        meta: { intent, session_id: sessionId, gap_id: gapId, fact_key: factKey, value },
      },
    });

    // If we have enough structured info, resolve the gap directly
    if (gapId && value && factKey) {
      const numValue = parseFloat(value);
      const resolvedValue = isNaN(numValue) ? value : numValue;

      const result = await resolveDealGap({
        action: "provide_value",
        gapId,
        factType: "FINANCIAL",
        factKey,
        value: resolvedValue,
        userId,
        dealId,
        bankId,
      });

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `Confirmed: ${factKey} = ${value}`
          : "Recorded for review",
        intent,
      });
    }

    // Unstructured intent — acknowledge, let Gemini continue conversation
    return NextResponse.json({
      ok: true,
      message: `Noted: ${intent}. Continue the interview to confirm specific values.`,
      intent,
    });
  } catch (e: unknown) {
    console.error("[banker-session/dispatch]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
