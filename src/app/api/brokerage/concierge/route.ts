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
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import {
  MODEL_CONCIERGE_REASONING,
  MODEL_CONCIERGE_EXTRACTION,
} from "@/lib/ai/models";
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
  buildBorrowerExtractionPrompt,
  computeNextCriticalField,
  mergeExtractedFacts,
} from "@/lib/brokerage/borrowerConversation";
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as ConciergeRequest;
    if (!body?.userMessage || typeof body.userMessage !== "string") {
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

    // Extract facts (Gemini Flash — cheap, fast, structured).
    const extractPrompt = buildExtractionPrompt(
      conciergeRow.conversation_history ?? [],
      body.userMessage,
    );
    const extractResult = await callGeminiJSON<Record<string, unknown>>({
      model: MODEL_CONCIERGE_EXTRACTION,
      prompt: extractPrompt,
      logTag: "brokerage-concierge-extract",
    });
    const newFacts = extractResult.result ?? {};
    const mergedFacts = mergeExtractedFacts(
      (conciergeRow.extracted_facts as Record<string, unknown>) ?? {},
      newFacts,
    );

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

    await updateDealNames(sb, session.deal_id, mergedFacts);

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

    // Generate the warm response (Gemini Pro — tone + next-question judgment).
    const responsePrompt = buildResponsePrompt(
      conciergeRow.conversation_history ?? [],
      body.userMessage,
      mergedFacts,
    );
    const responseResult = await callGeminiJSON<{
      message: string;
      next_question: string | null;
    }>({
      model: MODEL_CONCIERGE_REASONING,
      prompt: responsePrompt,
      logTag: "brokerage-concierge-respond",
    });
    const buddyOutput = responseResult.result ?? {
      message:
        "I'm glad to help. Tell me more about what you're looking to finance.",
      next_question: null,
    };

    const updatedHistory = [
      ...(conciergeRow.conversation_history ?? []),
      { role: "user", content: body.userMessage },
      { role: "assistant", content: buddyOutput.message },
    ];
    const progressPct = computeProgress(mergedFacts);

    await sb
      .from("borrower_concierge_sessions")
      .update({
        conversation_history: updatedHistory,
        extracted_facts: mergedFacts,
        progress_pct: progressPct,
        last_question: buddyOutput.next_question ?? null,
        last_response: body.userMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conciergeRow.id);

    await sb.from("ai_events").insert({
      deal_id: session.deal_id,
      scope: "brokerage_concierge",
      action: "turn",
      input_json: {
        userMessage: body.userMessage,
        source: body.source ?? "text",
      },
      output_json: {
        buddyResponse: buddyOutput.message,
        progressPct,
        sessionClaimed,
      },
      confidence: 0.9,
      requires_human_review: false,
    });

    // S1-5: score trigger is fire-and-forget for v1. Non-fatal on failure.
    const priorTurnCount =
      ((conciergeRow.conversation_history as unknown[]) ?? []).length / 2;
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

    return NextResponse.json({
      ok: true,
      dealId: session.deal_id,
      buddyResponse: buddyOutput.message,
      extractedFacts: mergedFacts,
      progressPct,
      nextQuestion: buddyOutput.next_question,
      sessionClaimed,
      tridentPreview: null,
      // SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 4 — canonical response
      // surface. Aliased alongside the existing fields so legacy clients
      // keep working while new code can target the documented contract.
      sessionId: session.deal_id,
      assistantMessage: buddyOutput.message,
      nextRequiredFields: computeNextRequiredFields(mergedFacts),
      readinessHint: readinessHintFromProgress(progressPct),
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

// ── Prompt builders ──────────────────────────────────────────────────────
//
// Arc 7 — extraction prompt, merge, and the next-critical-field ranker
// live in @/lib/brokerage/borrowerConversation so text (this route) and
// voice (/api/brokerage/voice/[sessionId]/dispatch) share exactly the same
// logic instead of drifting apart. SSN is intentionally last-4 only —
// Buddy should never ask for or record a full 9-digit SSN.

const buildExtractionPrompt = buildBorrowerExtractionPrompt;

function buildResponsePrompt(
  history: unknown[],
  userMessage: string,
  facts: Record<string, any>,
): string {
  const nextCritical = computeNextCriticalField(facts);

  return `You are Buddy, a warm and professional SBA loan concierge speaking directly to a prospective borrower on your public website.

Tone:
- Conversational, plain English, no banker jargon.
- Encouraging. SBA loans feel intimidating — make them feel capable.
- Ask ONE question at a time. The minimum next question that moves the process forward.
- Never ask for a full SSN — last 4 digits only. If a borrower needs to confirm a sensitive detail (date of birth, address) you already have, read it back rather than asking them to repeat it from scratch.

Conversation so far:
${JSON.stringify(history, null, 2)}

Borrower just said:
${userMessage}

Facts we know so far:
${JSON.stringify(facts, null, 2)}

Produce a response JSON:
{
  "message": "your warm conversational reply, including a question if needed",
  "next_question": "the question you asked, or null if you did not ask one"
}

Priorities for what to ask next, in order:
1. If we don't know their name, ask their name.
2. If we don't know their email, ask for it so we can save their progress.
3. If we don't know their business, ask what business they want to finance.
4. If we don't know loan amount, ask how much they're looking to borrow.
5. If we don't know use of proceeds, ask what the money is for.
6. If we don't know if they're buying a franchise, ask.
7. If we don't know their most recent annual revenue, ask for a rough figure.
${
  nextCritical
    ? `8. Once the essentials above are known, the single most valuable next question is about: "${nextCritical.label}" — it's required on ${nextCritical.formsUnlocked} SBA form field(s) still missing it. Ask about it naturally, in plain English (don't say "form field").`
    : ""
}

Return ONLY the JSON.`;
}

// ── Helpers ──────────────────────────────────────────────────────────────

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
