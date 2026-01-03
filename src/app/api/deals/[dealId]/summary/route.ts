import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";

type SummaryResponse =
  | {
      ok: true;
      summary: {
        short: string;
        long: string;
        updated_at: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

/**
 * POST /api/deals/[dealId]/summary
 * 
 * Generates ledger-backed AI explanation of deal state.
 * 
 * Rules:
 * - Read-only
 * - Ledger-derived (last N events)
 * - Never blocks UI
 * - Returns ok: true with fallback if AI fails
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
): Promise<NextResponse<SummaryResponse>> {
  try {
    const { dealId } = await ctx.params;

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "dealId required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Fetch last 20 pipeline events for narrative context
    const { data: events, error: eventsError } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, ui_state, ui_message, created_at, meta")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (eventsError) {
      console.error("[summary] Failed to fetch ledger:", eventsError);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch pipeline events" },
        { status: 500 }
      );
    }

    if (!events || events.length === 0) {
      // Deal has no events yet - return neutral summary
      return NextResponse.json({
        ok: true,
        summary: {
          short: "Deal workspace initialized",
          long: "This deal is ready for document uploads and borrower information. No processing events yet.",
          updated_at: new Date().toISOString(),
        },
      });
    }

    // Build narrative input from ledger
    const narrative = events
      .reverse() // Show chronologically
      .map((e) => {
        const ts = new Date(e.created_at).toLocaleString();
        return `[${ts}] ${e.event_key}: ${e.ui_message || e.ui_state}`;
      })
      .join("\n");

    // Call AI summarizer
    const aiResult = await aiJson<{ short: string; long: string }>({
      scope: "deal_summary",
      action: "explain_pipeline_state",
      system: `You are Buddy, a friendly SBA loan underwriting assistant. 
Generate a concise, banker-friendly explanation of the deal's current state based on recent pipeline events.

RULES:
- short: 1 sentence, ~10-15 words, present tense
- long: 2-3 sentences, explain what's happening and what comes next
- Never mention technical details (event_key, ui_state, etc.)
- Use calm, confident language
- If processing: mention what's being analyzed
- If waiting: mention what's needed
- If done: confirm completion

TONE: Helpful, professional, never anxious or uncertain.`,
      user: `Recent pipeline events (chronological):\n\n${narrative}\n\nGenerate summary explaining the current deal state.`,
      jsonSchemaHint: JSON.stringify({
        short: "Documents uploaded and ready for analysis",
        long: "Buddy has received tax returns and financial statements. Analysis is queued and will complete shortly. No action required from the banker.",
      }),
    });

    if (!aiResult.ok) {
      console.warn("[summary] AI failed:", aiResult.error);
      // Return graceful fallback
      const latest = events[0];
      return NextResponse.json({
        ok: true,
        summary: {
          short: latest.ui_message || "Processing in progress",
          long: `The system is currently ${latest.ui_state}. Recent activity: ${latest.event_key}. Buddy will update you when complete.`,
          updated_at: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      summary: {
        short: aiResult.result.short || "Processing",
        long: aiResult.result.long || "Buddy is working on your deal.",
        updated_at: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    console.error("[summary] Unexpected error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Internal error",
      },
      { status: 500 }
    );
  }
}
