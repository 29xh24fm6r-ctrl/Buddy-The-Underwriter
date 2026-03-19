import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 15;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();

    // Load deal context for system prompt injection
    const [dealRes, gapsRes, metricsRes] = await Promise.all([
      sb.from("deals").select("borrower_name, loan_amount, name").eq("id", dealId).maybeSingle(),
      sb.from("deal_gap_queue").select("description, resolution_prompt, priority").eq("deal_id", dealId).eq("status", "open").order("priority", { ascending: false }).limit(10),
      sb.from("deal_financial_facts").select("fact_key, fact_value_num").eq("deal_id", dealId).eq("is_superseded", false).in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR"]).not("fact_value_num", "is", null),
    ]);

    const deal = dealRes.data;
    const openGaps = gapsRes.data ?? [];
    const metrics = metricsRes.data ?? [];

    const metricSummary = metrics.map((m: any) => `${m.fact_key}: ${m.fact_value_num}`).join(", ");
    const gapSummary = openGaps.slice(0, 5).map((g: any, i: number) => `${i + 1}. ${g.description}`).join("\n");

    const systemPrompt = `You are Buddy, a senior credit analyst AI at a commercial bank.

You are conducting a structured credit review session with a banker about the following deal:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Deal: ${deal?.name ?? dealId}
- Loan Amount: $${deal?.loan_amount?.toLocaleString() ?? "Unknown"}

Known financial metrics:
${metricSummary || "None extracted yet"}

Open items requiring resolution (${openGaps.length} total):
${gapSummary || "None"}

YOUR ROLE:
- You are helping the banker resolve open gaps in the deal record
- Ask ONLY about specific open items listed above, one at a time
- ONLY collect objective, verifiable facts (numbers, dates, names, addresses, percentages)
- NEVER ask for subjective impressions ("does management seem trustworthy")
- NEVER make credit recommendations or judgments yourself
- Be concise, specific, and professional
- Acknowledge when you already have a piece of information — never ask for things already known
- When the banker provides a fact, confirm it back clearly: "Got it — I'll record [value] for [field]"

Start by briefly acknowledging what you already know about the deal, then focus on the highest priority open item.`;

    // Create ephemeral session token
    const session = await (openai.beta as any).realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      instructions: systemPrompt,
      voice: "alloy",
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
    });

    return NextResponse.json({
      ok: true,
      client_secret: session.client_secret,
      session_id: session.id,
      open_gaps: openGaps.length,
      context_summary: {
        borrower: deal?.borrower_name,
        open_gaps: openGaps.length,
        metrics_present: metrics.length,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
