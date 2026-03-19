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

    // ── Always recompute gaps before building the session ──────────────────
    //
    // This is the single most important invariant in the voice session flow.
    // Buddy's system instruction must reflect the TRUE state of the deal at
    // the moment the banker clicks "Start Interview" — not whatever happened
    // to be in the queue from a previous run (or nothing, if never seeded).
    //
    // computeDealGaps() will:
    //   1. Generate needs_confirmation gaps for all required facts that are
    //      present + confident but not yet banker-confirmed.
    //   2. Generate missing_fact gaps for any required facts not yet extracted.
    //   3. Generate low_confidence and conflict gaps as appropriate.
    //   4. Resolve any previously open gaps that are now satisfied.
    //
    // Only after this runs do we read the queue — guaranteeing accuracy.
    await computeDealGaps({ dealId, bankId: bankPick.bankId });

    // ── Load deal context + freshly computed gaps + key metrics ────────────
    const [dealRes, gapsRes, metricsRes, confirmedRes] = await Promise.all([
      sb.from("deals")
        .select("name, borrower_name, loan_amount, loan_type")
        .eq("id", dealId)
        .maybeSingle(),

      sb.from("deal_gap_queue")
        .select("fact_key, gap_type, description, resolution_prompt, priority")
        .eq("deal_id", dealId)
        .eq("bank_id", bankPick.bankId)
        .eq("status", "open")
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
    const openGaps = gapsRes.data ?? [];
    const metrics = metricsRes.data ?? [];
    const confirmedKeys = new Set((confirmedRes.data ?? []).map((f: any) => f.fact_key));

    // ── Determine true completeness ────────────────────────────────────────
    // A deal is ONLY complete when ALL required facts have been banker-confirmed.
    // "No open gaps" alone is not sufficient — the queue could be stale.
    const isGenuinelyComplete = (REQUIRED_FACT_KEYS as readonly string[]).every(
      k => confirmedKeys.has(k)
    );

    // ── Build metric summary for Buddy ─────────────────────────────────────
    const metricLines = metrics.map((m: any) => {
      const status = m.resolution_status === "confirmed" ? "✓ confirmed" : "extracted, unconfirmed";
      return `${m.fact_key}: ${Number(m.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 })} (${status})`;
    }).join("\n  ");

    const gapLines = openGaps.slice(0, 6).map((g: any, i: number) =>
      `${i + 1}. [${g.gap_type}] ${g.resolution_prompt ?? g.description}`
    ).join("\n");

    // ── Build deal-aware system instruction ────────────────────────────────
    //
    // The open items section distinguishes three states:
    //   - Genuinely complete: all required facts confirmed
    //   - Open items exist: list them for Buddy to work through
    // There is no third state. "No open items" means genuinely confirmed.
    const openItemsSection = isGenuinelyComplete
      ? `All ${REQUIRED_FACT_KEYS.length} required facts have been confirmed by a banker. The deal is complete.
If the banker wants to review or adjust any values, you can assist, but no confirmation is required.`
      : `OPEN ITEMS (${openGaps.length} — ask these in priority order):
${gapLines || "Gap computation is in progress — ask the banker to confirm each of the key metrics listed above."}`;

    const systemInstruction = `You are Buddy, a senior credit analyst AI conducting a structured credit interview for a commercial loan.

DEAL CONTEXT:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Loan: ${deal?.name ?? dealId} | Amount: $${Number(deal?.loan_amount ?? 0).toLocaleString()} | Type: ${(deal as any)?.loan_type ?? "Commercial"}

KEY METRICS (as extracted — unconfirmed means not yet verified by a banker):
  ${metricLines || "No financial metrics have been extracted yet. Ask the banker to provide them."}

${openItemsSection}

YOUR RULES:
1. Ask about ONE open item at a time. Be specific — cite the extracted value and ask the banker to confirm or correct it.
2. ONLY collect objective, verifiable facts: dollar amounts, dates, percentages, names, addresses, years, counts.
3. NEVER ask for subjective impressions ("does management seem strong", "is the borrower trustworthy"). These cannot appear in a credit file. If the banker volunteers such opinions, acknowledge briefly and redirect to documentable facts.
4. When you have confirmed a fact, immediately use the buddy_query tool to record it. Do not wait until the end of the session.
5. Never ask for something already marked as confirmed. Acknowledge it and move on.
6. Keep a professional but conversational tone. Be efficient. A full session should take 8–12 minutes.
7. Begin by briefly summarizing what you know about the deal (borrower, loan amount, key metrics), then ask about the highest-priority open item.

COMPLIANCE: This session is fully audited. Every fact you record becomes part of a regulatory credit file. Subjectivity is a fair lending violation. You are required by law to stick to objective, documentable facts only.`;

    // ── Create voice session ───────────────────────────────────────────────
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
        openGaps: openGaps.length,
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
