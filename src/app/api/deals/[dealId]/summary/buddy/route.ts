import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { aiJson } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/deals/[dealId]/summary/buddy
 * 
 * Generates "Buddy Explains This Deal" AI summary:
 * - What we know
 * - What's missing
 * - Risk flags
 * - Next steps
 * - Confidence + sources
 * 
 * GET /api/deals/[dealId]/summary/buddy
 * Returns latest summary
 * 
 * SECURITY: Banker-only, requires bank_id tenant check
 */

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const bankId = await getCurrentBankId();
    const { dealId } = await context.params;

    const sb = supabaseAdmin();

    // Gather context for the AI
    const dealContext = await gatherDealContext(dealId, bankId);

    if (!dealContext) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Generate summary using AI
    const systemPrompt = `You are Buddy, an AI underwriting assistant. You explain deals clearly, calmly, and accurately.

RULES:
- Never hallucinate numbers or facts
- If data is missing, say "Not enough information yet"
- Be concise and actionable
- Use first-person ("I reviewed...")
- No jargon; explain clearly
- Highlight risks honestly but calmly`;

    const userPrompt = `Deal Context:
${JSON.stringify(dealContext, null, 2)}

Generate a clear, concise summary of this deal. Include:
1. headline (one sentence)
2. summary_md (2-3 paragraphs in markdown)
3. next_steps (array of actionable items)
4. risks (array of risk flags)
5. confidence (0-1, how complete is the data)
6. sources_used (object with counts, e.g., {docs: 5, checklist_items: 12})

Be honest about missing data. Format as JSON.`;

    const jsonSchemaHint = JSON.stringify({
      headline: "Deal summary headline",
      summary_md: "Detailed summary in markdown",
      next_steps: ["Step 1", "Step 2"],
      risks: ["Risk 1"],
      confidence: 0.85,
      sources_used: { docs: 5, checklist_items: 12 },
    });

    const result = await aiJson({
      scope: "buddy_explains",
      action: "generate_summary",
      system: systemPrompt,
      user: userPrompt,
      jsonSchemaHint,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "ok" in result && !result.ok ? result.error : "AI generation failed" },
        { status: 500 }
      );
    }

    const summary = result.result;

    // Store summary
    const { error: insertError } = await sb.from("deal_summaries").insert({
      bank_id: bankId,
      deal_id: dealId,
      kind: "buddy_explains",
      summary_md: summary.summary_md ?? "No summary generated",
      payload: summary,
    });

    if (insertError) {
      console.error("Failed to store summary:", insertError);
      // Still return the summary even if storage fails
    }

    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (e: any) {
    console.error("Buddy summary error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Failed to generate summary" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const bankId = await getCurrentBankId();
    const { dealId } = await context.params;

    const sb = supabaseAdmin();

    const { data: latest, error } = await sb
      .from("deal_summaries")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("kind", "buddy_explains")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!latest) {
      return NextResponse.json(
        { ok: false, error: "No summary found. Generate one first." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      summary: latest.payload,
      created_at: latest.created_at,
    });
  } catch (e: any) {
    console.error("Get summary error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Failed to fetch summary" },
      { status: 500 }
    );
  }
}

async function gatherDealContext(dealId: string, bankId: string) {
  const sb = supabaseAdmin();

  // Get deal basics
  const { data: deal } = await sb
    .from("deals")
    .select("borrower_name, loan_type, stage, status, ready_at, submitted_at")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();

  if (!deal) return null;

  // Get checklist items
  const { data: checklistItems } = await sb
    .from("deal_checklist_items")
    .select("checklist_key, status, required, title")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  // Get recent timeline events
  const { data: timeline } = await sb
    .from("deal_timeline_events")
    .select("kind, title, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Get document inventory
  const { data: docs } = await sb
    .from("deal_documents")
    .select("original_filename, checklist_key, doc_year, status")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  const checklistStats = {
    total: checklistItems?.length ?? 0,
    satisfied: checklistItems?.filter((i) => i.status === "satisfied" || i.status === "received").length ?? 0,
    missing: checklistItems?.filter((i) => i.status === "missing").length ?? 0,
    required_missing: checklistItems?.filter((i) => i.status === "missing" && i.required).length ?? 0,
  };

  return {
    deal: {
      borrower_name: deal.borrower_name,
      loan_type: deal.loan_type,
      stage: deal.stage,
      status: deal.status,
      ready: !!deal.ready_at,
      submitted: !!deal.submitted_at,
    },
    checklist: {
      stats: checklistStats,
      missing_items: checklistItems
        ?.filter((i) => i.status === "missing")
        .map((i) => i.title ?? i.checklist_key) ?? [],
    },
    timeline: {
      recent_events: timeline?.slice(0, 5).map((e) => e.title) ?? [],
      event_count: timeline?.length ?? 0,
    },
    documents: {
      count: docs?.length ?? 0,
      filenames: docs?.map((d) => d.original_filename) ?? [],
    },
  };
}
