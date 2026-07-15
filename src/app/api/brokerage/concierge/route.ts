import "server-only";

/**
 * POST /api/brokerage/concierge
 *
 * Anonymous borrower entry point for the Buddy Brokerage funnel. Accepts
 * a single borrower message; creates or continues a draft deal under the
 * Buddy Brokerage tenant; extracts structured facts via Gemini Flash;
 * generates a warm next-question response via Gemini Pro; updates the
 * concierge session; auto-claims the session on first email; fires the
 * Buddy SBA Score as a non-fatal background call at turn 5 / on claim.
 *
 * No OpenAI. No bearer auth. The `buddy_borrower_session` HTTP-only
 * cookie is the identity primitive — its SHA-256 hash is the DB key.
 * Rate-limited per master plan §3a. See specs/brokerage/sprint-01-v2-canonical.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getBorrowerSession,
  claimBorrowerSession,
} from "@/lib/brokerage/sessionToken";
import { getOrCreateBorrowerSession } from "@/lib/brokerage/session";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { checkConciergeRateLimit } from "@/lib/brokerage/rateLimits";
import { streamGeminiText } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_REASONING } from "@/lib/ai/models";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";
import {
  detectTridentIntent,
  detectAssumptionsConfirmIntent,
  TRIDENT_PREVIEW_RESPONSE,
  ASSUMPTIONS_CONFIRMED_RESPONSE,
  ASSUMPTIONS_CONFIRM_BLOCKED_PREFIX,
} from "@/lib/brokerage/trident/conciergeIntent";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";
import {
  propagateBorrowerFacts,
  type BorrowerFacts,
} from "@/lib/brokerage/propagateBorrowerFacts";
import {
  buildCombinedConciergeTurnPrompt,
  CONCIERGE_FACTS_SENTINEL,
  mergeExtractedFacts,
  deepMerge,
} from "@/lib/brokerage/borrowerConversation";
import { createSentinelSplitter } from "@/lib/brokerage/sentinelStreamSplitter";
import { correctableFieldFor } from "@/lib/brokerage/correctableFacts";
import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";
import {
  ensureAssumptionsForPreview,
  persistAssumptionsDraft,
} from "@/lib/sba/sbaAssumptionsBootstrap";

export const runtime = "nodejs";
// Trident preview generation runs synchronously on intent match (PDF
// rendering + storage uploads). Fluid Compute default ceiling is 300s.
export const maxDuration = 300;

type ConciergeRequest = {
  userMessage: string;
  source?: "text" | "voice";
};

type CorrectFactRequest = { factPath: string; value?: unknown };

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as ConciergeRequest | CorrectFactRequest;

    // Method-merged onto this route (rather than a new route.ts file) to
    // stay under the route-slot warning threshold — see
    // src/lib/routes/__tests__/routeConsolidationGuard.test.ts. Distinct
    // request shape (factPath, no userMessage) so it never collides with a
    // real chat turn.
    if ("factPath" in body && typeof body.factPath === "string") {
      return handleCorrectFact(body);
    }

    if (!("userMessage" in body) || !body.userMessage || typeof body.userMessage !== "string") {
      return NextResponse.json(
        { ok: false, error: "userMessage required" },
        { status: 400 },
      );
    }
    if (body.userMessage.length > 4000) {
      return NextResponse.json(
        { ok: false, error: "userMessage too long" },
        { status: 400 },
      );
    }

    let session = await getBorrowerSession();
    const rl = await checkConciergeRateLimit({
      tokenHash: session?.tokenHash ?? null,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", reason: rl.reason },
        {
          status: 429,
          headers: { "retry-after": String(rl.retryAfterSeconds) },
        },
      );
    }

    // Tenant + admin-client setup is the most common preview failure point
    // (missing SUPABASE_SERVICE_ROLE_KEY, or BUDDY_BROKERAGE migration not
    // applied). Surface an explicit errorCode so the network tab shows root
    // cause without needing server logs.
    let sb: ReturnType<typeof supabaseAdmin>;
    try {
      sb = supabaseAdmin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[brokerage-concierge] supabase_admin_init_failed:", msg);
      return NextResponse.json(
        { ok: false, errorCode: "supabase_admin_init_failed", error: msg },
        { status: 500 },
      );
    }
    // Eagerly resolve the brokerage tenant id so a missing/ambiguous
    // singleton fails fast with a clear errorCode (instead of bubbling
    // up from inside getOrCreateBorrowerSession on first cookie-less
    // request).
    let brokerageBankId: string;
    try {
      brokerageBankId = await getBrokerageBankId();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[brokerage-concierge] brokerage_tenant_missing:", msg);
      return NextResponse.json(
        { ok: false, errorCode: "brokerage_tenant_missing", error: msg },
        { status: 500 },
      );
    }

    // First message — create draft deal + session via the single source of
    // truth (SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.1). The helper takes a
    // per-tenant pg_advisory_xact_lock inside claim_brokerage_session() and
    // is the only path in the codebase that inserts a brokerage_anonymous
    // deal row.
    if (!session) {
      session = await getOrCreateBorrowerSession();

      // Concierge session row is concierge-specific (transcript / facts /
      // progress). It is not created by the session helper; it lives 1:1
      // with the deal but only when the deal flows through the concierge.
      await sb
        .from("borrower_concierge_sessions")
        .insert({
          deal_id: session.deal_id,
          bank_id: session.bank_id,
          program: "7a",
        })
        .select("id")
        .maybeSingle();
    }

    const { data: conciergeRow } = await sb
      .from("borrower_concierge_sessions")
      .select("*")
      .eq("deal_id", session.deal_id)
      .maybeSingle();

    if (!conciergeRow) {
      return NextResponse.json(
        { ok: false, error: "Concierge session missing for deal" },
        { status: 500 },
      );
    }

    // ── Trident preview short-circuit ──
    // MUST run BEFORE any LLM call (extraction or response). If the borrower
    // is asking for the business plan / feasibility / projections /
    // lender-ready package, the concierge owns the canonical response and
    // triggers the existing trident generator. The full package stays gated
    // behind lender pick — never released in chat.
    const tridentIntent = detectTridentIntent(body.userMessage);
    if (tridentIntent.matched) {
      // Audit L5: do NOT log the raw borrower utterance (contains name/email/
      // phone/financials → PII in log sinks). Log the intent + length only.
      console.log("TRIDENT_INTENT_TRIGGERED", { chars: body.userMessage?.length ?? 0 });

      // generateSBAPackage (called by the trident generator) gates on a
      // confirmed buddy_sba_assumptions row. Borrowers in the brokerage
      // concierge funnel never go through the bank-side AssumptionInterview,
      // so we bootstrap + auto-confirm here. The validator is NOT bypassed:
      // missing structural inputs (revenue, loan amount, etc.) come back as
      // blockers and the borrower sees what's needed.
      const ensure = await ensureAssumptionsForPreview({
        dealId: session.deal_id,
        conciergeFacts:
          (conciergeRow.extracted_facts as Record<string, unknown>) ?? null,
        sb,
      });
      if (!ensure.ok) {
        const blockerMessage =
          "I can build a preview — I just need a couple more things first:\n\n" +
          ensure.blockers.map((b) => `• ${b}`).join("\n");
        const updatedHistory = [
          ...(conciergeRow.conversation_history ?? []),
          { role: "user", content: body.userMessage },
          { role: "assistant", content: blockerMessage },
        ];
        await sb
          .from("borrower_concierge_sessions")
          .update({
            conversation_history: updatedHistory,
            last_response: body.userMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conciergeRow.id);
        await sb.from("ai_events").insert({
          deal_id: session.deal_id,
          scope: "brokerage_concierge",
          action: "trident_intent_blocked",
          input_json: {
            userMessage: body.userMessage,
            source: body.source ?? "text",
          },
          output_json: {
            intent: tridentIntent.intent,
            matchedTerm: tridentIntent.matchedTerm,
            blockers: ensure.blockers,
          },
          confidence: 1,
          requires_human_review: false,
        });
        const blockedFacts =
          (conciergeRow.extracted_facts as Record<string, unknown>) ?? {};
        const blockedProgress = computeProgress(blockedFacts);
        return NextResponse.json({
          ok: true,
          dealId: session.deal_id,
          buddyResponse: blockerMessage,
          extractedFacts: blockedFacts,
          progressPct: blockedProgress,
          nextQuestion: null,
          sessionClaimed: false,
          tridentPreview: {
            intent: tridentIntent.intent,
            matchedTerm: tridentIntent.matchedTerm,
            latestPreviewUrl: `/api/brokerage/deals/${session.deal_id}/trident/latest-preview`,
            generation: {
              ok: false,
              bundleId: null,
              error: "assumptions_blocked",
              blockers: ensure.blockers,
            },
          },
          sessionId: session.deal_id,
          assistantMessage: blockerMessage,
          nextRequiredFields: computeNextRequiredFields(blockedFacts),
          readinessHint: readinessHintFromProgress(blockedProgress),
        });
      }

      // Generation MUST be awaited — fire-and-forget does not survive
      // serverless function shutdown on Vercel. The generator handles its
      // own bundle-row lifecycle: pending → running (sets
      // generation_started_at) → succeeded | failed (sets
      // generation_completed_at + generation_error on failure).
      const generationResult = await generateTridentBundle({
        dealId: session.deal_id,
        mode: "preview",
      });

      const existingFacts =
        (conciergeRow.extracted_facts as Record<string, unknown>) ?? {};
      const updatedHistory = [
        ...(conciergeRow.conversation_history ?? []),
        { role: "user", content: body.userMessage },
        { role: "assistant", content: TRIDENT_PREVIEW_RESPONSE },
      ];
      const progressPct = computeProgress(existingFacts);

      await sb
        .from("borrower_concierge_sessions")
        .update({
          conversation_history: updatedHistory,
          last_response: body.userMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conciergeRow.id);

      await sb.from("ai_events").insert({
        deal_id: session.deal_id,
        scope: "brokerage_concierge",
        action: "trident_intent",
        input_json: {
          userMessage: body.userMessage,
          source: body.source ?? "text",
        },
        output_json: {
          intent: tridentIntent.intent,
          matchedTerm: tridentIntent.matchedTerm,
          buddyResponse: TRIDENT_PREVIEW_RESPONSE,
          generation: generationResult.ok
            ? { ok: true, bundleId: generationResult.bundleId }
            : {
                ok: false,
                bundleId: generationResult.bundleId,
                error: generationResult.error,
              },
        },
        confidence: 1,
        requires_human_review: false,
      });

      return NextResponse.json({
        ok: true,
        dealId: session.deal_id,
        buddyResponse: TRIDENT_PREVIEW_RESPONSE,
        extractedFacts: existingFacts,
        progressPct,
        nextQuestion: null,
        sessionClaimed: false,
        tridentPreview: {
          intent: tridentIntent.intent,
          matchedTerm: tridentIntent.matchedTerm,
          latestPreviewUrl: `/api/brokerage/deals/${session.deal_id}/trident/latest-preview`,
          generation: generationResult.ok
            ? {
                ok: true,
                bundleId: generationResult.bundleId,
                paths: generationResult.paths,
              }
            : {
                ok: false,
                bundleId: generationResult.bundleId,
                error: generationResult.error,
              },
        },
        sessionId: session.deal_id,
        assistantMessage: TRIDENT_PREVIEW_RESPONSE,
        nextRequiredFields: computeNextRequiredFields(existingFacts),
        readinessHint: readinessHintFromProgress(progressPct),
      });
    }

    // ── Assumptions confirmation short-circuit ──
    // Borrower says "looks good", "confirm", "lock it in" → flip the
    // assumptions row from draft to confirmed. Runs BEFORE the LLM so the
    // confirmation isn't lost to a generic conversational reply.
    // ensureAssumptionsForPreview is the right primitive here: it rebuilds
    // the candidate from current prefill + concierge facts, validates, and
    // upserts as confirmed on pass / draft + blockers on fail.
    const confirmIntent = detectAssumptionsConfirmIntent(body.userMessage);
    if (confirmIntent.matched) {
      const ensure = await ensureAssumptionsForPreview({
        dealId: session.deal_id,
        conciergeFacts:
          (conciergeRow.extracted_facts as Record<string, unknown>) ?? null,
        sb,
      });

      const buddyMessage = ensure.ok
        ? ASSUMPTIONS_CONFIRMED_RESPONSE
        : `${ASSUMPTIONS_CONFIRM_BLOCKED_PREFIX}\n\n` +
          ensure.blockers.map((b) => `• ${b}`).join("\n");

      const existingFacts =
        (conciergeRow.extracted_facts as Record<string, unknown>) ?? {};

      // Confirmation is the strongest signal we get — write the
      // confirmed facts through to the canonical tables now.
      propagateBorrowerFacts({
        dealId: session.deal_id,
        bankId: brokerageBankId,
        facts: existingFacts as BorrowerFacts,
        sb,
      }).catch((e) => {
        console.warn(
          "[brokerage-concierge] confirm-path propagation failed (non-fatal):",
          e?.message ?? String(e),
        );
      });

      const updatedHistory = [
        ...(conciergeRow.conversation_history ?? []),
        { role: "user", content: body.userMessage },
        { role: "assistant", content: buddyMessage },
      ];
      const progressPct = computeProgress(existingFacts);

      await sb
        .from("borrower_concierge_sessions")
        .update({
          conversation_history: updatedHistory,
          last_response: body.userMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conciergeRow.id);

      await sb.from("ai_events").insert({
        deal_id: session.deal_id,
        scope: "brokerage_concierge",
        action: ensure.ok
          ? "assumptions_confirmed"
          : "assumptions_confirm_blocked",
        input_json: {
          userMessage: body.userMessage,
          matchedTerm: confirmIntent.matchedTerm,
          source: body.source ?? "text",
        },
        output_json: ensure.ok
          ? { assumptionsId: ensure.assumptionsId, buddyResponse: buddyMessage }
          : { blockers: ensure.blockers, buddyResponse: buddyMessage },
        confidence: 1,
        requires_human_review: false,
      });

      return NextResponse.json({
        ok: true,
        dealId: session.deal_id,
        buddyResponse: buddyMessage,
        extractedFacts: existingFacts,
        progressPct,
        nextQuestion: null,
        sessionClaimed: false,
        tridentPreview: null,
        assumptionsConfirmation: ensure.ok
          ? { ok: true, assumptionsId: ensure.assumptionsId }
          : { ok: false, blockers: ensure.blockers },
        sessionId: session.deal_id,
        assistantMessage: buddyMessage,
        nextRequiredFields: computeNextRequiredFields(existingFacts),
        readinessHint: readinessHintFromProgress(progressPct),
      });
    }

    // ── Combined turn: extraction + warm reply in ONE Gemini call, streamed ──
    // Previously two sequential calls (extract, then respond) — that's the
    // dominant latency cost per turn. Now one call, streamed to the client:
    // the reply (STEP 1 of the prompt) flushes to the browser as it's
    // generated; the structured facts (STEP 2, after CONCIERGE_FACTS_SENTINEL)
    // are buffered here and never shown to the borrower.
    const existingFacts =
      (conciergeRow.extracted_facts as Record<string, unknown>) ?? {};
    const prompt = buildCombinedConciergeTurnPrompt(
      conciergeRow.conversation_history ?? [],
      body.userMessage,
      existingFacts,
    );
    const priorTurnCount =
      ((conciergeRow.conversation_history as unknown[]) ?? []).length / 2;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        const splitter = createSentinelSplitter(CONCIERGE_FACTS_SENTINEL);

        try {
          for await (const delta of streamGeminiText({
            model: MODEL_CONCIERGE_REASONING,
            prompt,
            logTag: "brokerage-concierge-turn",
            // Fail fast rather than let a slow model call stall the
            // borrower's reply — whatever text already streamed through is
            // kept and used as the reply (see the fallback logic below).
            timeoutMs: 15_000,
          })) {
            const toShow = splitter.feed(delta);
            if (toShow) sendEvent("token", { text: toShow });
          }
        } catch (e) {
          console.warn(
            "[brokerage-concierge] stream failed (using partial text, if any):",
            e instanceof Error ? e.message : String(e),
          );
        }

        const { messageText: streamedMessage, trailingToShow, factsRaw } = splitter.finish();
        if (trailingToShow) sendEvent("token", { text: trailingToShow });

        let messageText = streamedMessage;
        let newFacts: Record<string, unknown> = {};
        let nextQuestion: string | null = null;

        if (factsRaw !== null) {
          const cleaned = factsRaw
            .replace(/```json\s*/gi, "")
            .replace(/```/g, "")
            .trim();
          try {
            const parsed = JSON.parse(cleaned) as {
              extracted_facts?: Record<string, unknown>;
              next_question?: string | null;
            };
            newFacts = parsed.extracted_facts ?? {};
            nextQuestion = parsed.next_question ?? null;
          } catch (e) {
            console.warn(
              "[brokerage-concierge] facts JSON parse failed (non-fatal, no facts extracted this turn):",
              e instanceof Error ? e.message : String(e),
            );
          }
        }
        // factsRaw === null means the sentinel never arrived (stream died
        // early, or the model deviated from the format) — no facts
        // extracted this turn, but the borrower still got whatever text
        // did stream through as their reply.

        if (!messageText) {
          messageText =
            "I'm glad to help. Tell me more about what you're looking to finance.";
          sendEvent("token", { text: messageText });
        }

        const mergedFacts = mergeExtractedFacts(existingFacts, newFacts);

        // Proactive draft assumptions persistence — keeps buddy_sba_assumptions
        // tracking the borrower's current best-known inputs from turn 1, so a
        // valid row always exists before trident generation. Never downgrades
        // a confirmed row; non-fatal on failure (the trident path's
        // ensureAssumptionsForPreview is the safety net).
        persistAssumptionsDraft({
          dealId: session.deal_id,
          conciergeFacts: mergedFacts as Parameters<
            typeof persistAssumptionsDraft
          >[0]["conciergeFacts"],
          sb,
        }).catch((e) => {
          console.warn(
            "[brokerage-concierge] draft assumptions persist failed (non-fatal):",
            e?.message ?? String(e),
          );
        });

        // Claim the session the first time an email appears.
        const extractedEmail = (newFacts as any)?.borrower?.email;
        let sessionClaimed = false;
        if (
          typeof extractedEmail === "string" &&
          extractedEmail.includes("@") &&
          !session.claimed_email
        ) {
          await claimBorrowerSession({
            tokenHash: session.tokenHash,
            email: extractedEmail,
          });
          sessionClaimed = true;
        }

        // Display-name convenience update — never needs to gate the
        // borrower's reply. Fire-and-forget, same as the propagation call
        // below.
        updateDealNames(sb, session.deal_id, mergedFacts).catch((e) => {
          console.warn(
            "[brokerage-concierge] updateDealNames failed (non-fatal):",
            e?.message ?? String(e),
          );
        });

        // Write-through: push extracted facts to the canonical tables the
        // score engine and packaging pipeline actually read. Non-fatal —
        // the conversation never breaks because a propagation write failed.
        propagateBorrowerFacts({
          dealId: session.deal_id,
          bankId: brokerageBankId,
          facts: mergedFacts as BorrowerFacts,
          sb,
        })
          .then((r) => {
            if (!r.ok) {
              console.warn(
                "[brokerage-concierge] fact propagation partial failure:",
                r.errors.join("; "),
              );
            }
          })
          .catch((e) => {
            console.warn(
              "[brokerage-concierge] fact propagation failed (non-fatal):",
              e?.message ?? String(e),
            );
          });

        const updatedHistory = [
          ...(conciergeRow.conversation_history ?? []),
          { role: "user", content: body.userMessage },
          { role: "assistant", content: messageText },
        ];
        const progressPct = computeProgress(mergedFacts);

        await sb
          .from("borrower_concierge_sessions")
          .update({
            conversation_history: updatedHistory,
            extracted_facts: mergedFacts,
            progress_pct: progressPct,
            last_question: nextQuestion,
            last_response: body.userMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conciergeRow.id);

        // Audit log — pure telemetry, never needs to gate the borrower's reply.
        sb.from("ai_events")
          .insert({
            deal_id: session.deal_id,
            scope: "brokerage_concierge",
            action: "turn",
            input_json: {
              userMessage: body.userMessage,
              source: body.source ?? "text",
            },
            output_json: { buddyResponse: messageText, progressPct, sessionClaimed },
            confidence: 0.9,
            requires_human_review: false,
          })
          .then(({ error }) => {
            if (error) {
              console.warn("[brokerage-concierge] ai_events insert failed (non-fatal):", error.message);
            }
          });

        // S1-5: score trigger is fire-and-forget for v1. Non-fatal on failure.
        const turnCount = priorTurnCount + 1;
        if (turnCount >= 5 || sessionClaimed) {
          computeBuddySBAScore({
            dealId: session.deal_id,
            sb,
            context: "concierge_fact_change",
          }).catch((e) => {
            console.warn(
              "[brokerage-concierge] score compute failed (non-fatal):",
              e?.message ?? String(e),
            );
          });
        }

        sendEvent("done", {
          ok: true,
          dealId: session.deal_id,
          buddyResponse: messageText,
          extractedFacts: mergedFacts,
          progressPct,
          nextQuestion,
          sessionClaimed,
          tridentPreview: null,
          // SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 4 — canonical response
          // surface. Aliased alongside the existing fields so legacy clients
          // keep working while new code can target the documented contract.
          sessionId: session.deal_id,
          assistantMessage: messageText,
          nextRequiredFields: computeNextRequiredFields(mergedFacts),
          readinessHint: readinessHintFromProgress(progressPct),
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[brokerage-concierge] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 4 response shape.
export type BrokerageConciergeResponse = {
  ok: boolean;
  sessionId: string;
  dealId?: string;
  assistantMessage: string;
  nextRequiredFields: string[];
  readinessHint?: string;
};

function computeNextRequiredFields(facts: Record<string, any>): string[] {
  const missing: string[] = [];
  if (!facts?.borrower?.first_name) missing.push("borrower.first_name");
  if (!facts?.borrower?.email) missing.push("borrower.email");
  if (!facts?.business?.legal_name && !facts?.business?.industry_description) {
    missing.push("business.legal_name_or_industry");
  }
  if (!facts?.loan?.amount_requested) missing.push("loan.amount_requested");
  if (!facts?.loan?.use_of_proceeds) missing.push("loan.use_of_proceeds");
  if (typeof facts?.business?.is_franchise !== "boolean") {
    missing.push("business.is_franchise");
  }
  return missing;
}

function readinessHintFromProgress(progressPct: number): string {
  if (progressPct >= 100) return "Ready to upload supporting documents.";
  if (progressPct >= 60) return "Almost there — a few facts to go.";
  if (progressPct >= 30) return "Good start — keep going.";
  return "Tell Buddy a bit more about your business and loan need.";
}

// Arc 7 — the combined turn prompt (extraction + reply in one call),
// merge, and the next-critical-field ranker live in
// @/lib/brokerage/borrowerConversation so text (this route) and voice
// (/api/brokerage/voice/[sessionId]/dispatch) share exactly the same fact
// schema and merge behavior instead of drifting apart. SSN is intentionally
// last-4 only — Buddy should never ask for or record a full 9-digit SSN.

// ── Helpers ──────────────────────────────────────────────────────────────

function coerceCorrectionValue(raw: unknown, type: "string" | "number" | "boolean"): unknown {
  if (raw == null) return null;
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") return typeof raw === "boolean" ? raw : null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/**
 * Lets a borrower correct a single fact Buddy captured wrong (e.g. Gemini
 * mis-heard "$250,000" as "$25,000"). See correctableFacts.ts for why the
 * editable set is a curated subset, not the whole BORROWER_FIELD_REGISTRY.
 *
 * Two writes happen:
 *  1. extracted_facts on borrower_concierge_sessions — always, so the next
 *     chat turn's mergeExtractedFacts() uses the corrected value instead of
 *     silently reverting it.
 *  2. A force-write to the mapped canonical column (borrowers.* or
 *     deals.loan_amount), bypassing propagateBorrowerFacts's normal
 *     "fill-if-null" precedence — that precedence exists to stop a later,
 *     lower-confidence AI guess from clobbering an earlier real answer, but
 *     an explicit borrower correction IS the real answer and must win even
 *     if a wrong value was already propagated there. Non-fatal: if there's
 *     nowhere to write yet (e.g. no borrowers row for this deal), the
 *     correction still lands in extracted_facts and self-heals into
 *     borrowers on the next natural propagateBorrowerFacts call.
 */
async function handleCorrectFact(body: CorrectFactRequest): Promise<NextResponse> {
  const session = await getBorrowerSession();
  if (!session) {
    // Same convention as the main chat path: no session cookie means "not
    // found," not "unauthorized" — avoids confirming a session exists.
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const field = correctableFieldFor(body.factPath);
  if (!field) {
    return NextResponse.json({ ok: false, error: "field_not_editable" }, { status: 400 });
  }

  const value = coerceCorrectionValue(body.value, field.type);
  const sb = supabaseAdmin();

  const { data: conciergeRow } = await sb
    .from("borrower_concierge_sessions")
    .select("id, extracted_facts")
    .eq("deal_id", session.deal_id)
    .maybeSingle();

  if (!conciergeRow) {
    return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  }

  const [scope, fieldKey] = body.factPath.split(".");
  const patch = { [scope]: { [fieldKey]: value } };
  const updatedFacts = deepMerge(
    (conciergeRow.extracted_facts as Record<string, unknown>) ?? {},
    patch,
  );

  const { error: factsErr } = await sb
    .from("borrower_concierge_sessions")
    .update({ extracted_facts: updatedFacts, updated_at: new Date().toISOString() })
    .eq("id", conciergeRow.id);

  if (factsErr) {
    console.error("[concierge/correct-fact] extracted_facts update failed", factsErr);
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }

  try {
    if (body.factPath === "loan.amount_requested") {
      await sb.from("deals").update({ loan_amount: value }).eq("id", session.deal_id);
    } else if (scope === "business") {
      const entry = BORROWER_FIELD_REGISTRY.find((f) => f.factPath === body.factPath);
      if (entry) {
        const { data: deal } = await sb
          .from("deals")
          .select("borrower_id")
          .eq("id", session.deal_id)
          .maybeSingle();
        if (deal?.borrower_id) {
          await sb.from("borrowers").update({ [entry.sourceColumn]: value }).eq("id", deal.borrower_id);
        }
      }
    }
  } catch (err) {
    console.error("[concierge/correct-fact] canonical force-write failed (non-fatal)", err);
  }

  return NextResponse.json({ ok: true, extractedFacts: updatedFacts });
}

async function updateDealNames(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  facts: Record<string, any>,
): Promise<void> {
  const firstName = facts?.borrower?.first_name;
  const lastName = facts?.borrower?.last_name;
  const bizName = facts?.business?.legal_name;
  if (!firstName && !bizName) return;

  const personName =
    [firstName, lastName].filter(Boolean).join(" ") || null;
  const display = bizName ?? personName ?? "New borrower inquiry";

  await sb
    .from("deals")
    .update({ display_name: display, borrower_name: personName })
    .eq("id", dealId);
}

function computeProgress(facts: Record<string, any>): number {
  const checks = [
    !!facts?.borrower?.first_name,
    !!facts?.borrower?.email,
    !!facts?.business?.legal_name || !!facts?.business?.industry_description,
    !!facts?.loan?.amount_requested,
    !!facts?.loan?.use_of_proceeds,
    typeof facts?.business?.is_franchise === "boolean",
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
