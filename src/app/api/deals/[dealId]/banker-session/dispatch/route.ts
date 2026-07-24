// route-class: WORKER — two valid callers:
//   1. The Fly.io gateway (legacy WS relay), gated by x-gateway-secret.
//      Trusts userId/bankId from the body, since the gateway already
//      resolved them from deal_voice_sessions server-side.
//   2. SPEC-BUDDY-VOICE-WEBRTC: the banker's own browser, directly, once
//      voice moved to WebRTC with no server-side relay in front of it.
//      Gated by requireDealCockpitAccess instead — userId/bankId are
//      always re-derived from the caller's own authenticated session in
//      this branch, never trusted from the request body.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { secretEquals } from "@/lib/brokerage/secretEquals";

export const runtime = "nodejs";
export const maxDuration = 15;

const GATEWAY_SECRET = process.env.BUDDY_GATEWAY_SECRET ?? "";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await props.params;
  const body = await req.json().catch(() => ({}));

  const providedSecret = req.headers.get("x-gateway-secret");
  let userId: string;
  let bankId: string;

  if (GATEWAY_SECRET && secretEquals(providedSecret, GATEWAY_SECRET)) {
    userId = body.userId;
    bankId = body.bankId;
  } else {
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    userId = auth.userId;
    bankId = auth.bankId;
  }

  try {
    const {
      intent,
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

      // God Tier #67 — fire-and-forget auto-complete check after fact confirmation
      if (result.ok) {
        Promise.resolve().then(async () => {
          try {
            const { computeSpreadCompleteness } = await import(
              "@/lib/classicSpread/computeSpreadCompleteness"
            );
            const completeness = await computeSpreadCompleteness(dealId);
            if (!completeness?.isGodTier) return;

            // Check for open missing-fact gaps
            const { data: openGaps } = await sb
              .from("deal_gap_queue")
              .select("id")
              .eq("deal_id", dealId)
              .eq("status", "open")
              .eq("gap_type", "missing_fact")
              .limit(1);
            if ((openGaps ?? []).length > 0) return;

            // Check that no memo was generated in the last 5 minutes
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: recentMemo } = await sb
              .from("canonical_memo_narratives")
              .select("id")
              .eq("deal_id", dealId)
              .gt("generated_at", fiveMinAgo)
              .limit(1)
              .maybeSingle();
            if (recentMemo) return;

            // Trigger memo regeneration
            const baseUrl = process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : process.env.NEXT_PUBLIC_APP_URL ?? "";
            if (!baseUrl) return;

            await fetch(`${baseUrl}/api/deals/${dealId}/credit-memo/generate`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-auto-trigger": "voice-completion",
                "x-gateway-secret": process.env.BUDDY_GATEWAY_SECRET ?? "",
              },
              body: JSON.stringify({
                trigger: "voice_session_complete",
                completeness_score: completeness.score,
              }),
            }).catch(() => {});

            // Emit observability milestone
            const { emitDealMilestone } = await import("@/lib/telemetry/emitDealMilestone");
            await emitDealMilestone({
              eventKey: "voice.memo_auto_complete_triggered",
              dealId,
              bankId: bankId ?? "",
              status: "ok",
              payload: {
                completeness_score: completeness.score,
                trigger: "voice_dispatch",
                fact_key: factKey,
              },
              mirrorToObservability: true,
            }).catch(() => {});
          } catch {
            // Always non-fatal
          }
        }).catch(() => {});
      }

      return NextResponse.json({
        ok: result.ok,
        message: result.ok
          ? `Confirmed: ${factKey} = ${value}`
          : "Recorded for review",
        intent,
      });
    }

    // Unstructured intent — acknowledge, let the realtime voice model continue the conversation
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
