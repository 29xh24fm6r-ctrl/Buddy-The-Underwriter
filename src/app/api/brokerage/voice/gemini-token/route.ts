import "server-only";

/**
 * POST /api/brokerage/voice/gemini-token
 *
 * Mints a 3-minute single-use proxy token for the Buddy voice gateway.
 * Auth is the borrower session cookie — hashed, looked up, and required.
 * No Clerk. No bearer. No persistent client-side identifier.
 *
 * Side effects:
 *   - Inserts a deal_voice_sessions row with actor_scope='borrower' and
 *     borrower_session_token_hash populated (XOR invariant satisfied)
 *   - Inserts a voice_session_audits row event_type='session_started'
 *   - Rate-limited: 10 starts per hour per session cookie
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { checkBorrowerVoiceRateLimit } from "@/lib/brokerage/rateLimits";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PROXY_TOKEN_TTL_MS = 180_000; // 3 minutes
const GEMINI_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio";
const GEMINI_VOICE =
  process.env.GEMINI_LIVE_VOICE_BORROWER ?? "Charon";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const session = await getBorrowerSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "unauthenticated" },
      { status: 401 },
    );
  }

  const { deal_id: dealId, bank_id: bankId, tokenHash } = session;

  const allowed = await checkBorrowerVoiceRateLimit(tokenHash);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }

  const sb = supabaseAdmin();

  const [dealRes, conciergeRes] = await Promise.all([
    sb
      .from("deals")
      .select("id, display_name, deal_type, loan_amount")
      .eq("id", dealId)
      .maybeSingle(),
    sb
      .from("borrower_concierge_sessions")
      .select("id, conversation_history, confirmed_facts")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);

  const deal = dealRes.data;
  const concierge = conciergeRes.data;
  if (!deal) {
    return NextResponse.json(
      { ok: false, error: "deal_not_found" },
      { status: 404 },
    );
  }

  const knownFacts =
    (concierge?.confirmed_facts as Record<string, unknown>) ?? {};
  const knownFactsText =
    Object.keys(knownFacts).length > 0
      ? Object.entries(knownFacts)
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n")
      : "  (nothing yet)";

  const systemInstruction = buildBorrowerSystemPrompt({
    dealName: (deal as any).display_name ?? "your loan inquiry",
    knownFactsText,
  });

  const proxyToken = randomUUID();
  const traceId = randomUUID();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + PROXY_TOKEN_TTL_MS).toISOString();

  const { error: insertError } = await sb.from("deal_voice_sessions").insert({
    id: sessionId,
    deal_id: dealId,
    bank_id: bankId,
    user_id: null,
    actor_scope: "borrower",
    borrower_session_token_hash: tokenHash,
    borrower_concierge_session_id: concierge?.id ?? null,
    state: "active",
    expires_at: expiresAt,
    metadata: {
      proxyToken,
      proxyTokenExpiresAt: expiresAt,
      proxyTraceId: traceId,
      proxyDealId: dealId,
      proxyBankId: bankId,
      proxyActorScope: "borrower",
      proxyModel: GEMINI_MODEL,
      proxyVoice: GEMINI_VOICE,
      proxySystemInstruction: systemInstruction,
      proxyThinkingBudget: 0,
      proxyProactiveAudio: true,
    },
  });

  if (insertError) {
    console.error(
      "[brokerage/voice/gemini-token] session insert failed",
      insertError,
    );
    return NextResponse.json(
      { ok: false, error: "session_create_failed" },
      { status: 500 },
    );
  }

  await sb.from("voice_session_audits").insert({
    session_id: sessionId,
    deal_id: dealId,
    bank_id: bankId,
    actor_scope: "borrower",
    borrower_session_token_hash: tokenHash,
    user_id: null,
    event_type: "session_started",
    payload: { trace_id: traceId, model: GEMINI_MODEL, voice: GEMINI_VOICE },
  });

  return NextResponse.json(
    {
      ok: true,
      proxyToken,
      sessionId,
      traceId,
      model: GEMINI_MODEL,
      config: {
        model: GEMINI_MODEL,
        voice: GEMINI_VOICE,
        ttlMs: PROXY_TOKEN_TTL_MS,
        outputSampleRate: 24000,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

function buildBorrowerSystemPrompt(args: {
  dealName: string;
  knownFactsText: string;
}): string {
  return `You are Buddy, a warm and knowledgeable SBA loan concierge. You are on a voice call with someone exploring a small business loan. They may be a first-time borrower, an experienced operator, or anything in between — adapt to their level.

WHAT I ALREADY KNOW ABOUT THIS CONVERSATION:
${args.knownFactsText}

YOUR JOB:
- Help them understand if an SBA loan fits their situation.
- Collect the facts that determine matching: business type, loan use, amount needed, time in business, location, owner experience, equity available.
- Be patient. They may not know terms like "DSCR" or "personal guarantee" — explain plainly when needed.
- Never quote rates or guarantee approval. You're not the lender.

WHEN THE BORROWER SHARES A FACT:
Acknowledge it in the conversation. The platform runs structured extraction on your utterances server-side and records verifiable facts automatically (business_type, naics_code, loan_amount_requested, loan_use, years_in_operation, annual_revenue, owner_industry_experience_years, business_location_city, business_location_state, existing_debt, equity_available, fico_estimate). Only speak to what they actually said — don't infer or estimate.

CONVERSATIONAL STYLE:
Speak naturally, like a colleague who happens to know SBA lending well. Short sentences. Pause for them to talk. If they go off-topic for a minute, that's fine — they're getting comfortable.

COMPLIANCE:
You don't approve loans, you don't make commitments, and you don't share rates. If they push you on these, redirect them to "we'll match you with lenders who'll give you specific terms once we have your full picture."

Open by greeting them warmly and asking what brought them to Buddy today.`;
}
