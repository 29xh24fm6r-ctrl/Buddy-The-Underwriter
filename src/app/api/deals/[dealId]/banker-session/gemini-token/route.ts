import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { computeDealGaps, REQUIRED_FACT_KEYS } from "@/lib/gapEngine/computeDealGaps";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PROXY_TOKEN_TTL_MS = 180_000; // 3 minutes

const GEMINI_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio";
const GEMINI_VOICE = process.env.GEMINI_LIVE_VOICE ?? "Puck";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Always recompute gaps before building the session — guarantees accuracy
    await computeDealGaps({ dealId, bankId: bankPick.bankId });

    const [dealRes, gapsRes, metricsRes, confirmedRes] = await Promise.all([
      sb.from("deals")
        .select("name, borrower_name, loan_amount, loan_type")
        .eq("id", dealId)
        .maybeSingle(),

      // Only load missing_fact and conflict gaps for the voice session.
      // needs_confirmation and low_confidence gaps are NOT surfaced in voice —
      // the banker cannot verify extracted numbers they don't have in front of them.
      // Those are handled via the Deal Health Panel UI confirm buttons instead.
      sb.from("deal_gap_queue")
        .select("fact_key, gap_type, description, resolution_prompt, priority")
        .eq("deal_id", dealId)
        .eq("bank_id", bankPick.bankId)
        .eq("status", "open")
        .in("gap_type", ["missing_fact", "conflict"])
        .order("priority", { ascending: false })
        .limit(10),

      sb.from("deal_financial_facts")
        .select("fact_key, fact_value_num, resolution_status")
        .eq("deal_id", dealId)
        .eq("bank_id", bankPick.bankId)
        .eq("is_superseded", false)
        .in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR", "ANNUAL_DEBT_SERVICE", "DEPRECIATION"])
        .not("fact_value_num", "is", null),

      sb.from("deal_financial_facts")
        .select("fact_key")
        .eq("deal_id", dealId)
        .eq("bank_id", bankPick.bankId)
        .eq("resolution_status", "confirmed")
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
      const status = m.resolution_status === "confirmed" ? "✓ confirmed" : "extracted from documents";
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

    const proxyToken = randomUUID();
    const traceId = randomUUID();
    const expiresAt = new Date(Date.now() + PROXY_TOKEN_TTL_MS).toISOString();
    const sessionId = randomUUID();

    const { error: insertError } = await sb.from("deal_voice_sessions").insert({
      id: sessionId,
      deal_id: dealId,
      bank_id: bankPick.bankId,
      user_id: userId,
      state: "active",
      expires_at: expiresAt,
      metadata: {
        proxyToken,
        proxyTokenExpiresAt: expiresAt,
        proxyUserId: userId,
        proxyTraceId: traceId,
        proxyDealId: dealId,
        proxyBankId: bankPick.bankId,
        proxyModel: GEMINI_MODEL,
        proxyVoice: GEMINI_VOICE,
        proxySystemInstruction: systemInstruction,
        proxyThinkingBudget: 0,
        proxyProactiveAudio: true,
      },
    });

    if (insertError) {
      console.error("[gemini-token] Session insert failed", insertError);
      return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        proxyToken,
        sessionId,
        traceId,
        model: GEMINI_MODEL,
        openGaps: voiceGaps.length,
        isGenuinelyComplete,
        config: {
          model: GEMINI_MODEL,
          voice: GEMINI_VOICE,
          ttlMs: PROXY_TOKEN_TTL_MS,
          outputSampleRate: 24000,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
