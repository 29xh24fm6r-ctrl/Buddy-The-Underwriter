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

    const isGenuinelyComplete = (REQUIRED_FACT_KEYS as readonly string[]).every(
      k => confirmedKeys.has(k)
    );

    // Build metric summary — show extracted value + confirmation status
    const metricsMap = new Map(metrics.map((m: any) => [m.fact_key, m]));

    const metricLines = metrics.map((m: any) => {
      const val = Number(m.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 });
      const status = m.resolution_status === "confirmed" ? "✓ confirmed" : "needs your confirmation";
      return `  ${m.fact_key}: ${val} (${status})`;
    }).join("\n");

    // Separate gaps by type — drives different Buddy behavior
    const confirmationGaps = openGaps.filter((g: any) =>
      g.gap_type === "needs_confirmation" || g.gap_type === "low_confidence"
    );
    const missingGaps = openGaps.filter((g: any) => g.gap_type === "missing_fact");
    const conflictGaps = openGaps.filter((g: any) => g.gap_type === "conflict");

    // Build confirmation script — Buddy reads each value and asks yes/no
    const confirmationScript = confirmationGaps.map((g: any) => {
      const fact = metricsMap.get(g.fact_key);
      const val = fact
        ? Number(fact.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 })
        : "unknown";
      return `  - ${g.fact_key}: I have this as ${val}. I'll read it to you and ask if it looks right.`;
    }).join("\n");

    const missingScript = missingGaps.map((g: any) =>
      `  - ${g.fact_key}: Not yet extracted — I'll ask you to provide this.`
    ).join("\n");

    const openItemsSection = isGenuinelyComplete
      ? `All ${REQUIRED_FACT_KEYS.length} required facts have been confirmed. The deal record is complete.
If the banker wants to review or adjust anything, you can assist.`
      : `OPEN ITEMS (${openGaps.length} total):

Items where I have a number and need you to confirm it sounds right:
${confirmationScript || "  (none)"}

Items where the number is missing and I need you to provide it:
${missingScript || "  (none)"}

${conflictGaps.length > 0 ? `Items with conflicting values that need resolution:\n${conflictGaps.map((g: any) => `  - ${g.fact_key}: ${g.description}`).join("\n")}` : ""}`;

    const systemInstruction = `You are Buddy, a senior credit analyst AI conducting a structured credit interview for a commercial loan.

DEAL CONTEXT:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Loan: ${deal?.name ?? dealId} | Amount: $${Number(deal?.loan_amount ?? 0).toLocaleString()} | Type: ${(deal as any)?.loan_type ?? "Commercial"}

KEY METRICS EXTRACTED FROM DOCUMENTS:
${metricLines || "  No financial metrics extracted yet."}

${openItemsSection}

YOUR RULES — READ THESE CAREFULLY:

RULE 1 — TWO COMPLETELY DIFFERENT TYPES OF OPEN ITEMS:

  TYPE A — "needs_confirmation" and "low_confidence" gaps:
  I ALREADY HAVE THE NUMBER. The banker does NOT need to look anything up.
  Your job is to READ THE NUMBER ALOUD and ask a yes/no question.
  Example: "Based on the tax returns, I have total revenue at one million, three hundred sixty thousand dollars. Does that match what you're seeing in the file?"
  The banker just says yes or no. If yes, record it confirmed. If no, ask what the correct number is.
  NEVER say "what is your revenue?" for a needs_confirmation gap. I have it. Just confirm it.

  TYPE B — "missing_fact" gaps:
  I DON'T have the number at all. Ask the banker to provide it.
  Example: "I wasn't able to extract the collateral appraised value from the documents. Do you have that figure handy?"

RULE 2 — One item at a time. Work through confirmation items first (quick yes/no), then missing items.

RULE 3 — ONLY collect objective, verifiable facts: dollar amounts, dates, percentages, names, addresses, years, counts. NEVER ask for opinions, impressions, or subjective assessments. If the banker volunteers opinions, acknowledge briefly and redirect.

RULE 4 — When a fact is confirmed, immediately use buddy_query to record it. Don't batch at the end.

RULE 5 — Never ask for something already marked confirmed. Skip it.

RULE 6 — Begin by briefly introducing the deal (borrower name, loan amount, one or two key metrics), then say something like: "I have a few numbers I want to run by you quickly — I'll read each one and you just tell me if it looks right." Then work through them one at a time.

RULE 7 — Keep the tone like a colleague on a phone call, not a form. Efficient, professional, human. Target 5–10 minutes total.

COMPLIANCE: Every confirmed fact becomes part of a regulatory credit file. Subjectivity is a fair lending violation.`;

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
