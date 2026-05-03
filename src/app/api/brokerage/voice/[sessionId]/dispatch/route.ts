import "server-only";

/**
 * POST /api/brokerage/voice/[sessionId]/dispatch
 *
 * Gateway-only endpoint. Dispatches events from the Fly voice gateway back
 * into the app:
 *   - utterance (borrower | assistant)     → conversation_history append
 *                                          + server-side fact extraction
 *                                            (borrower utterances only) →
 *                                            confirmed_facts merge
 *   - tool_call                            → audit only, NEVER mutates
 *                                            confirmed_facts (S2-2)
 *   - session_ended                        → state='ended' + audit
 *   - error                                → audit
 *
 * Authentication: x-gateway-secret header must equal BUDDY_GATEWAY_SECRET.
 * The browser has no way to reach this route directly because it can't
 * forge that header without learning the secret.
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
  const provided = req.headers.get("x-gateway-secret");
  if (!GATEWAY_SECRET || !provided || provided !== GATEWAY_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { sessionId } = await params;
  const body = (await req.json().catch(() => null)) as DispatchBody | null;
  if (!body || !body.intent) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
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

  const dealId = (session as any).deal_id as string;
  const bankId = (session as any).bank_id as string;
  const tokenHash = (session as any).borrower_session_token_hash as string;
  const conciergeSessionId =
    ((session as any).borrower_concierge_session_id as string | null) ?? null;

  switch (body.intent) {
    case "utterance": {
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
        payload: { text: body.text },
      });

      if (conciergeSessionId) {
        const { data: cs } = await sb
          .from("borrower_concierge_sessions")
          .select("conversation_history")
          .eq("id", conciergeSessionId)
          .maybeSingle();

        const existing = ((cs?.conversation_history as unknown[]) ?? []);
        const next = [
          ...existing,
          {
            role: body.speaker === "borrower" ? "user" : "assistant",
            content: body.text,
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
        const intent = detectTridentIntent(body.text);
        if (intent.matched) {
          console.log("TRIDENT_INTENT_TRIGGERED", body.text);
          // Pull concierge facts + conversation history to feed the
          // assumptions bootstrap. Conversation history drives the
          // borrower-quoted-numbers extractor (sbaAssumptionsFromConversation).
          let conciergeFacts: Record<string, unknown> | null = null;
          let conversationHistory: Array<{ role: string; content: string }> =
            [];
          if (conciergeSessionId) {
            const { data: cs } = await sb
              .from("borrower_concierge_sessions")
              .select("extracted_facts, conversation_history")
              .eq("id", conciergeSessionId)
              .maybeSingle();
            conciergeFacts =
              (cs?.extracted_facts as Record<string, unknown>) ?? null;
            conversationHistory =
              (cs?.conversation_history as Array<{
                role: string;
                content: string;
              }> | null) ?? [];
          }
          // Bootstrap + auto-confirm assumptions before invoking the
          // generator. Validator is NOT bypassed; blockers surface in
          // the audit payload so the gateway can adjust its spoken reply.
          const ensure = await ensureAssumptionsForPreview({
            dealId,
            conciergeFacts,
            conversationHistory,
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

      // S2-2: ONLY path to confirmed_facts mutation.
      if (body.speaker === "borrower" && conciergeSessionId) {
        const extracted = await extractBorrowerFacts(body.text);
        if (extracted && Object.keys(extracted).length > 0) {
          const { data: cs2 } = await sb
            .from("borrower_concierge_sessions")
            .select("confirmed_facts")
            .eq("id", conciergeSessionId)
            .maybeSingle();
          const merged = {
            ...((cs2?.confirmed_facts as Record<string, unknown>) ?? {}),
            ...extracted,
          };
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

const ALLOWED_FACT_KEYS = new Set([
  "business_type",
  "naics_code",
  "loan_amount_requested",
  "loan_use",
  "years_in_operation",
  "annual_revenue",
  "owner_industry_experience_years",
  "business_location_city",
  "business_location_state",
  "existing_debt",
  "equity_available",
  "fico_estimate",
]);

async function extractBorrowerFacts(
  text: string,
): Promise<Record<string, unknown> | null> {
  if (text.trim().length < 10) return null;

  const result = await callGeminiJSON<Record<string, unknown>>({
    model: MODEL_CONCIERGE_EXTRACTION,
    logTag: "borrower-voice-extract",
    systemInstruction: `You extract structured facts from spoken utterances by SBA loan applicants. Return ONLY a JSON object with the fields you can confidently extract. Omit fields you cannot. Never guess.

Allowed fields:
  business_type (string)
  naics_code (string, 6-digit)
  loan_amount_requested (number, USD)
  loan_use (string, brief)
  years_in_operation (number)
  annual_revenue (number, USD)
  owner_industry_experience_years (number)
  business_location_city (string)
  business_location_state (string, 2-letter)
  existing_debt (number, USD)
  equity_available (number, USD)
  fico_estimate (number)

If the utterance contains no extractable facts, return {}.`,
    prompt: text,
  });

  if (!result.ok || !result.result) return null;

  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result.result)) {
    if (ALLOWED_FACT_KEYS.has(k) && v != null) filtered[k] = v;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

// Exported for unit testing.
export const __test_extractBorrowerFacts = extractBorrowerFacts;
