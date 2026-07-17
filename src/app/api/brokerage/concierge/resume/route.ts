import "server-only";

/**
 * GET /api/brokerage/concierge/resume
 *
 * Read-only session rehydration for the /start concierge page. Previously
 * a returning borrower (page reload, same-browser return visit) always
 * saw a blank chat at 0% progress — the client only ever populated
 * dealId/transcript/progress from a POST response, with no "resume from
 * cookie" call on mount, directly contradicting the page's own copy
 * ("Your progress stays in this browser so you can come back without
 * starting over").
 *
 * Never mints a new session/cookie/deal — mirrors the existing
 * conversation state if one exists, or reports no session.
 */

import { NextResponse } from "next/server";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getBorrowerSessionFromRequest();
    if (!session) {
      return NextResponse.json({ ok: true, dealId: null });
    }

    const sb = supabaseAdmin();
    const { data: conciergeSession } = await sb
      .from("borrower_concierge_sessions")
      .select("conversation_history, extracted_facts, progress_pct")
      .eq("deal_id", session.deal_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      dealId: session.deal_id,
      conversationHistory: Array.isArray(conciergeSession?.conversation_history)
        ? conciergeSession.conversation_history
        : [],
      extractedFacts: conciergeSession?.extracted_facts ?? {},
      progressPct:
        typeof conciergeSession?.progress_pct === "number"
          ? conciergeSession.progress_pct
          : 0,
    });
  } catch (error) {
    console.error("[brokerage/concierge/resume] error:", error);
    // Fail soft — a resume failure should never block a borrower from
    // starting a fresh conversation.
    return NextResponse.json({ ok: true, dealId: null });
  }
}
