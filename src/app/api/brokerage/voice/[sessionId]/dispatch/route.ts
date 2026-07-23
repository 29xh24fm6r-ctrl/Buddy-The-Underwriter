import "server-only";

/**
 * POST /api/brokerage/voice/[sessionId]/dispatch
 *
 * Dispatches events back into the app for a borrower voice session:
 *   - utterance (borrower | assistant)     → conversation_history append
 *                                          + server-side fact extraction
 *                                            (borrower utterances only) →
 *                                            confirmed_facts merge
 *   - tool_call                            → audit only, NEVER mutates
 *                                            confirmed_facts (S2-2)
 *   - session_ended                        → state='ended' + audit
 *   - error                                → audit
 *
 * Authentication — two valid callers:
 *   1. The Fly.io gateway (legacy WS relay): x-gateway-secret header must
 *      equal BUDDY_GATEWAY_SECRET.
 *   2. SPEC-BUDDY-VOICE-WEBRTC: the borrower's own browser, directly, once
 *      voice moved to WebRTC with no server-side relay in front of it.
 *      Gated by the borrower session cookie's tokenHash matching this
 *      exact session's borrower_session_token_hash — proves the caller
 *      owns *this* voice session, not just some borrower session.
 *
 * Scope: sessions with actor_scope='banker' return 400 — banker voice has
 * its own dispatch route at /api/deals/[dealId]/banker-session/dispatch.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_EXTRACTION } from "@/lib/ai/models";
import { detectTridentIntent } from "@/lib/brokerage/trident/conciergeIntent";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";
import { ensureAssumptionsForPreview } from "@/lib/sba/sbaAssumptionsBootstrap";
import { secretEquals } from "@/lib/brokerage/secretEquals";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import {
  buildBorrowerExtractionPrompt,
  mergeExtractedFacts,
} from "@/lib/brokerage/borrowerConversation";
import {
  propagateBorrowerFacts,
  type BorrowerFacts,
} from "@/lib/brokerage/propagateBorrowerFacts";
import { redactSsnPatterns } from "@/lib/brokerage/redactSensitive";

export const runtime = "nodejs";
// Trident preview generation runs synchronously on intent match (PDF
// rendering + storage uploads). Fluid Compute default ceiling is 300s.
export const maxDuration = 300;

const GATEWAY_SECRET = process.env.BUDDY_GATEWAY_SECRET;

type DispatchBody =
  | { intent: "utterance"; speaker: "borrower" | "assistant"; text: string }
  | { intent: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { intent: "session_ended"; reason?: string }
  | { intent: "error"; error: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await params;
  const body = (await req.json().catch(() => null)) as DispatchBody | null;
  if (!body || !body.intent) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
  }

  // Gateway-secret path stays a fast pre-DB short-circuit, matching the
  // original behavior exactly (no session lookup, no cookie read). Only
  // when it's absent/wrong do we fall through to the borrower-cookie
  // path — which requires a borrower session to even exist before
  // touching the DB, so an unauthenticated caller with no cookie and no
  // secret still gets a plain 401 with zero DB round trips.
  const providedSecret = req.headers.get("x-gateway-secret");
  const isGatewayAuthed = secretEquals(providedSecret, GATEWAY_SECRET);

  let borrowerTokenHash: string | null = null;
  if (!isGatewayAuthed) {
    try {
      const borrowerSession = await getBorrowerSession();
      borrowerTokenHash = borrowerSession?.tokenHash ?? null;
    } catch {
      borrowerTokenHash = null;
    }
    if (!borrowerTokenHash) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const sb = supabaseAdmin();

  const { data: session } = await sb
    .from("deal_voice_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_not_found" },
      { status: 404 },
    );
  }
  if ((session as any).actor_scope !== "borrower") {
    return NextResponse.json(
      { ok: false, error: "wrong_actor_scope" },
      { status: 400 },
    );
  }

  if (!isGatewayAuthed) {
    // SPEC-BUDDY-VOICE-WEBRTC: proves the caller owns *this* voice
    // session (not just some borrower session) before it can touch
    // this session's data.
    const ownsThisSession = secretEquals(borrowerTokenHash, (session as any).borrower_session_token_hash);
    if (!ownsThisSession) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const dealId = (session as any).deal_id as string;
  const bankId = (session as any).bank_id as string;
  const tokenHash = (session as any).borrower_session_token_hash as string;
  const conciergeSessionId =
    ((session as any).borrower_concierge_session_id as string | null) ?? null;

  switch (body.intent) {
    case "utterance": {
      // Arc 7: forms in this product only ever need SSN last-4 — a
      // borrower accidentally speaking a full SSN should never persist in
      // plaintext (transcript, audit log, or the extraction round trip).
      const text = redactSsnPatterns(body.text);

      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type:
          body.speaker === "borrower"
            ? "utterance_borrower"
            : "utterance_assistant",
        payload: { text },
      });

      let conversationHistory: unknown[] = [];
      if (conciergeSessionId) {
        const { data: cs } = await sb
          .from("borrower_concierge_sessions")
          .select("conversation_history")
          .eq("id", conciergeSessionId)
          .maybeSingle();

        conversationHistory = (cs?.conversation_history as unknown[]) ?? [];
        const next = [
          ...conversationHistory,
          {
            role: body.speaker === "borrower" ? "user" : "assistant",
            content: text,
            channel: "voice",
            ts: new Date().toISOString(),
          },
        ];

        await sb
          .from("borrower_concierge_sessions")
          .update({
            conversation_history: next,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conciergeSessionId);
      }

      // Trident preview trigger: if a borrower utterance asks for the
      // business plan / feasibility / projections / lender-ready package,
      // run preview regeneration synchronously and audit the intent. The
      // voice gateway uses the audit row to keep its spoken response on
      // the canonical "preview package; full unlocks at pick" line —
      // never the "copy/paste into a template" fallback.
      if (body.speaker === "borrower") {
        const intent = detectTridentIntent(text);
        if (intent.matched) {
          // Audit L5: do NOT log the raw utterance (contains name/email/
          // phone/financials → PII in log sinks). Mirrors concierge/route.ts.
          console.log("TRIDENT_INTENT_TRIGGERED", { chars: text.length });
          // Pull concierge facts to feed the assumptions bootstrap.
          let conciergeFacts: Record<string, unknown> | null = null;
          if (conciergeSessionId) {
            const { data: csFacts } = await sb
              .from("borrower_concierge_sessions")
              .select("extracted_facts")
              .eq("id", conciergeSessionId)
              .maybeSingle();
            conciergeFacts =
              (csFacts?.extracted_facts as Record<string, unknown>) ?? null;
          }
          // Bootstrap + auto-confirm assumptions before invoking the
          // generator. Validator is NOT bypassed; blockers surface in
          // the audit payload so the gateway can adjust its spoken reply.
          const ensure = await ensureAssumptionsForPreview({
            dealId,
            conciergeFacts,
            sb,
          });
          if (!ensure.ok) {
            await sb.from("voice_session_audits").insert({
              session_id: sessionId,
              deal_id: dealId,
              bank_id: bankId,
              actor_scope: "borrower",
              borrower_session_token_hash: tokenHash,
              user_id: null,
              event_type: "trident_preview_intent_blocked",
              payload: {
                intent: intent.intent,
                matchedTerm: intent.matchedTerm,
                blockers: ensure.blockers,
              },
            });
          } else {
            // Generation MUST be awaited — fire-and-forget does not survive
            // serverless function shutdown on Vercel. The generator handles
            // its own bundle-row lifecycle: pending → running (sets
            // generation_started_at) → succeeded | failed (sets
            // generation_completed_at + generation_error on failure).
            const generationResult = await generateTridentBundle({
              dealId,
              mode: "preview",
            });
            await sb.from("voice_session_audits").insert({
              session_id: sessionId,
              deal_id: dealId,
              bank_id: bankId,
              actor_scope: "borrower",
              borrower_session_token_hash: tokenHash,
              user_id: null,
              event_type: "trident_preview_intent",
              payload: {
                intent: intent.intent,
                matchedTerm: intent.matchedTerm,
                generation: generationResult.ok
                  ? { ok: true, bundleId: generationResult.bundleId }
                  : {
                      ok: false,
                      bundleId: generationResult.bundleId,
                      error: generationResult.error,
                    },
              },
            });
          }
        }
      }

      // S2-2: ONLY path to confirmed_facts mutation. Arc 7 — shares the
      // exact same extraction prompt and merge logic as the text
      // concierge (@/lib/brokerage/borrowerConversation), so a fact a
      // borrower states by voice gets the same coverage as one typed in
      // chat, instead of the old narrow 12-key allow-list.
      if (body.speaker === "borrower" && conciergeSessionId) {
        const extracted = await extractBorrowerFacts(text, conversationHistory);
        if (extracted && Object.keys(extracted).length > 0) {
          const { data: cs2 } = await sb
            .from("borrower_concierge_sessions")
            .select("confirmed_facts")
            .eq("id", conciergeSessionId)
            .maybeSingle();
          const merged = mergeExtractedFacts(
            (cs2?.confirmed_facts as Record<string, unknown>) ?? {},
            extracted,
          );
          await sb
            .from("borrower_concierge_sessions")
            .update({
              confirmed_facts: merged,
              updated_at: new Date().toISOString(),
            })
            .eq("id", conciergeSessionId);

          await sb.from("voice_session_audits").insert({
            session_id: sessionId,
            deal_id: dealId,
            bank_id: bankId,
            actor_scope: "borrower",
            borrower_session_token_hash: tokenHash,
            user_id: null,
            event_type: "fact_extracted",
            payload: { keys: Object.keys(extracted) },
          });

          // Write-through to the canonical form-building tables — closes
          // the gap where voice-confirmed facts previously only ever
          // lived in this session-local JSONB column. Non-fatal, same
          // fire-and-forget pattern the text concierge uses.
          propagateBorrowerFacts({
            dealId,
            bankId,
            facts: merged as BorrowerFacts,
            sb,
          }).catch((e) => {
            console.warn(
              "[voice-dispatch] fact propagation failed (non-fatal):",
              e?.message ?? String(e),
            );
          });
        }
      }

      return NextResponse.json({ ok: true });
    }

    case "tool_call": {
      // Audit only. S2-2: client-injected tool_call payloads MUST NOT
      // mutate confirmed_facts. Extraction from audited utterances is
      // the only write path.
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "tool_call",
        payload: { tool: body.toolName, args: body.args },
      });
      return NextResponse.json({ ok: true });
    }

    case "session_ended": {
      await sb
        .from("deal_voice_sessions")
        .update({ state: "ended" })
        .eq("id", sessionId);
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "session_ended",
        payload: { reason: body.reason ?? "client_disconnect" },
      });
      return NextResponse.json({ ok: true });
    }

    case "error": {
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "error",
        payload: { error: body.error },
      });
      return NextResponse.json({ ok: true });
    }

    default: {
      return NextResponse.json(
        { ok: false, error: "unknown_intent" },
        { status: 400 },
      );
    }
  }
}

/**
 * Extracts structured facts from a single voice utterance, using the same
 * registry-driven extraction prompt as the text concierge (@/lib/
 * brokerage/borrowerConversation). Passing conversationHistory lets the
 * model resolve pronouns/context across turns the same way text does.
 */
async function extractBorrowerFacts(
  text: string,
  conversationHistory: unknown[],
): Promise<Record<string, unknown> | null> {
  if (text.trim().length < 10) return null;

  const prompt = buildBorrowerExtractionPrompt(conversationHistory, text);
  const result = await callGeminiJSON<Record<string, unknown>>({
    model: MODEL_CONCIERGE_EXTRACTION,
    logTag: "borrower-voice-extract",
    prompt,
  });

  if (!result.ok || !result.result) return null;
  return Object.keys(result.result).length > 0 ? result.result : null;
}

// Exported for unit testing.
export const __test_extractBorrowerFacts = extractBorrowerFacts;
