import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { computeDealGaps, REQUIRED_FACT_KEYS } from "@/lib/gapEngine/computeDealGaps";
import { TRUSTED_RESOLUTION_FILTER, resolutionLabel } from "@/lib/financialReview/isTrustedFinancialResolution";
import { BUDDY_QUERY_TOOL } from "@/lib/voice/buddyQueryTool";
import { mintRealtimeClientSecret } from "@/lib/voice/mintRealtimeClientSecret";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// SPEC-BUDDY-VOICE-WEBRTC: this used to be a 3-minute Fly-gateway proxy
// token TTL. The ephemeral OpenAI client_secret has its own, much shorter
// expiry (set in mintRealtimeClientSecret) — this constant now only sizes
// the deal_voice_sessions row's expires_at, kept generous since a banker
// session can legitimately run 8-12 minutes per the system prompt below.
const SESSION_ROW_TTL_MS = 15 * 60_000; // 15 minutes

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { userId, bankId } = auth;
    const sb = supabaseAdmin();

    // Always recompute gaps before building the session — guarantees accuracy
    await computeDealGaps({ dealId, bankId });

    const [dealRes, gapsRes, metricsRes, confirmedRes] = await Promise.all([
      sb.from("deals")
        .select("name, borrower_name, loan_amount, loan_type")
        .eq("id", dealId)
        .maybeSingle(),

      // Only load missing_fact and conflict gaps for the voice session.
      // low_confidence gaps are NOT surfaced in voice — the banker cannot
      // verify extracted numbers they don't have in front of them. Those are
      // handled via the evidence-backed Financial Validation panel instead.
      sb.from("deal_gap_queue")
        .select("fact_key, gap_type, description, resolution_prompt, priority")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("status", "open")
        .in("gap_type", ["missing_fact", "conflict"])
        .order("priority", { ascending: false })
        .limit(10),

      sb.from("deal_financial_facts")
        .select("fact_key, fact_value_num, resolution_status")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("is_superseded", false)
        .in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR", "ANNUAL_DEBT_SERVICE", "DEPRECIATION"])
        .not("fact_value_num", "is", null),

      sb.from("deal_financial_facts")
        .select("fact_key")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .in("resolution_status", TRUSTED_RESOLUTION_FILTER)
        .eq("is_superseded", false)
        .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[]),
    ]);

    const deal = dealRes.data;
    const voiceGaps = gapsRes.data ?? []; // Only missing_fact and conflict
    const metrics = metricsRes.data ?? [];
    const confirmedKeys = new Set((confirmedRes.data ?? []).map((f: any) => f.fact_key));

    const isGenuinelyComplete = (REQUIRED_FACT_KEYS as readonly string[]).every(
      k => confirmedKeys.has(k)
    );

    // Build metric summary for Buddy's context
    const metricLines = metrics.map((m: any) => {
      const val = Number(m.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 });
      const status = `\u2713 ${resolutionLabel(m.resolution_status)}`;
      return `  ${m.fact_key}: ${val} (${status})`;
    }).join("\n");

    // Build the voice agenda — only items Buddy needs to ASK about
    const missingGaps = voiceGaps.filter((g: any) => g.gap_type === "missing_fact");
    const conflictGaps = voiceGaps.filter((g: any) => g.gap_type === "conflict");

    const buildVoiceAgenda = () => {
      if (voiceGaps.length === 0) return null;

      const lines: string[] = [];

      if (missingGaps.length > 0) {
        lines.push("FACTS I NEED FROM YOU (not in any document):");
        missingGaps.forEach((g: any, i: number) => {
          lines.push(`  ${i + 1}. ${g.resolution_prompt ?? g.description}`);
        });
      }

      if (conflictGaps.length > 0) {
        lines.push("\nCONFLICTS I NEED YOU TO RESOLVE (different values found across documents):");
        conflictGaps.forEach((g: any, i: number) => {
          lines.push(`  ${i + 1}. ${g.description}`);
        });
      }

      return lines.join("\n");
    };

    const voiceAgenda = buildVoiceAgenda();

    const openItemsSection = isGenuinelyComplete
      ? `The financial data is complete — all required facts are confirmed.
Use this session to discuss the deal, answer the banker's questions, or collect any qualitative context they want to share.`
      : voiceAgenda
        ? `YOUR AGENDA FOR THIS SESSION:\n${voiceAgenda}`
        : `The extracted financial data looks complete. No missing facts or conflicts to resolve.
The banker may want to discuss the deal or share qualitative context — listen and record any new verifiable facts they volunteer.`;

    const systemInstruction = `You are Buddy, a senior credit analyst AI. You are on a voice call with a banker to discuss a commercial loan file.

DEAL:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Loan: ${deal?.name ?? dealId} | Amount: $${Number(deal?.loan_amount ?? 0).toLocaleString()} | Type: ${(deal as any)?.loan_type ?? "Commercial"}

WHAT I ALREADY EXTRACTED FROM THE DOCUMENTS:
${metricLines || "  No financial metrics extracted yet."}

${openItemsSection}

HOW TO CONDUCT THIS SESSION:

1. WHAT TO ASK VS WHAT NOT TO ASK:
   - ASK about things that are genuinely missing from the documents (missing_fact gaps above).
   - ASK the banker to clarify conflicting values between documents (conflict gaps above).
   - DO NOT ask the banker to confirm numbers you already extracted. They do not have the documents memorized. If a number is already extracted, it will be confirmed separately via the UI — not in this call.
   - DO NOT quiz the banker. This is a collaborative conversation, not an interrogation.

2. WHAT THIS CALL IS REALLY FOR:
   Beyond the specific gaps above, use this session to gather qualitative context that documents cannot provide:
   - Management background: How long has the owner been in this business? Prior industry experience?
   - Collateral: Is there real estate collateral? Personal guarantee? Property details?
   - Business context: What is driving this loan request? How will proceeds be used?
   - Relationships: Does the borrower have an existing relationship with the bank?
   Ask about these naturally in conversation — do not treat them as a checklist.

3. RECORDING FACTS:
   When the banker shares a specific verifiable fact (a dollar amount, a date, a percentage, a name, an address), use buddy_query to record it immediately.
   Only objective, documentable facts. No subjective impressions.

4. TONE:
   Speak like a colleague on a phone call — efficient, professional, conversational.
   Open by briefly summarizing the deal and what you know, then ask your first question.
   Target 8–12 minutes total.

COMPLIANCE: Every recorded fact becomes part of a regulatory credit file. Only objective, verifiable facts. Subjectivity is a fair lending violation.`;

    const traceId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_ROW_TTL_MS).toISOString();
    const sessionId = randomUUID();

    const minted = await mintRealtimeClientSecret({
      model: REALTIME_MODEL,
      voice: REALTIME_VOICE,
      instructions: systemInstruction,
      tools: [BUDDY_QUERY_TOOL],
    });

    if (!minted.ok) {
      console.error("[realtime-token] client_secret mint failed", minted.error);
      return NextResponse.json({ ok: false, error: "client_secret_mint_failed" }, { status: 502 });
    }

    const { error: insertError } = await sb.from("deal_voice_sessions").insert({
      id: sessionId,
      deal_id: dealId,
      bank_id: bankId,
      user_id: userId,
      state: "active",
      expires_at: expiresAt,
      metadata: {
        proxyUserId: userId,
        proxyTraceId: traceId,
        proxyDealId: dealId,
        proxyBankId: bankId,
        proxyModel: REALTIME_MODEL,
        proxyVoice: REALTIME_VOICE,
        proxySystemInstruction: systemInstruction,
      },
    });

    if (insertError) {
      console.error("[realtime-token] Session insert failed", insertError);
      return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        actorScope: "banker",
        clientSecret: minted.clientSecret,
        sessionId,
        traceId,
        model: REALTIME_MODEL,
        openGaps: voiceGaps.length,
        isGenuinelyComplete,
        config: {
          model: REALTIME_MODEL,
          voice: REALTIME_VOICE,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[realtime-token POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
