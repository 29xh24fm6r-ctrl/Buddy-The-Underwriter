import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 15;
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

    // Load deal + open gaps + key metrics for system instruction
    const [dealRes, gapsRes, metricsRes] = await Promise.all([
      sb.from("deals").select("name, borrower_name, loan_amount, loan_type").eq("id", dealId).maybeSingle(),
      sb.from("deal_gap_queue").select("fact_key, description, resolution_prompt, priority")
        .eq("deal_id", dealId).eq("bank_id", bankPick.bankId).eq("status", "open")
        .order("priority", { ascending: false }).limit(10),
      sb.from("deal_financial_facts").select("fact_key, fact_value_num")
        .eq("deal_id", dealId).eq("bank_id", bankPick.bankId).eq("is_superseded", false)
        .in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR", "ANNUAL_DEBT_SERVICE"])
        .not("fact_value_num", "is", null),
    ]);

    const deal = dealRes.data;
    const openGaps = gapsRes.data ?? [];
    const metrics = metricsRes.data ?? [];

    // Build deal-aware system instruction
    const metricLines = metrics.map((m: any) =>
      `${m.fact_key}: ${Number(m.fact_value_num).toLocaleString()}`
    ).join(", ");

    const gapLines = openGaps.slice(0, 6).map((g: any, i: number) =>
      `${i + 1}. ${g.resolution_prompt ?? g.description}`
    ).join("\n");

    const systemInstruction = `You are Buddy, a senior credit analyst AI conducting a structured credit interview.

DEAL CONTEXT:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Loan: ${deal?.name ?? dealId} | Amount: $${Number(deal?.loan_amount ?? 0).toLocaleString()} | Type: ${(deal as any)?.loan_type ?? "Commercial"}
- Known metrics: ${metricLines || "None yet extracted"}

OPEN ITEMS (${openGaps.length} total — ask these in priority order):
${gapLines || "No open items — deal record is complete."}

YOUR RULES:
1. Ask about ONE open item at a time. Be specific, cite what you already know.
2. ONLY collect objective, verifiable facts: dollar amounts, dates, percentages, names, addresses, years, counts.
3. NEVER ask for subjective impressions ("does management seem strong", "is the borrower trustworthy"). These cannot appear in a credit file.
4. When you have confirmed a fact, use the buddy_query tool to record it immediately. Do not wait until the end.
5. Acknowledge facts the deal already has — never ask for something already confirmed.
6. Keep a professional but conversational tone. Be efficient. A full session should take 8-12 minutes.
7. Begin by briefly acknowledging what you know about the deal, then ask about the highest-priority open item.

COMPLIANCE: This session is fully audited. Every fact you record becomes part of a regulatory credit file. Subjectivity is a fair lending violation.`;

    // Create voice session
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
