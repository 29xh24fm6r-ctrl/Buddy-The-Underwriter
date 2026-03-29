import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callOmegaGemini, safeParseJSON } from "@/core/omega/omegaGeminiClient";
import { resolvePortfolioIntelligencePack } from "@/core/portfolio/resolvePortfolioIntelligencePack";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/omega/portfolio
 * Generate Omega advisory for the portfolio.
 *
 * HARD RULE: This route NEVER writes to canonical tables.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Resolve portfolio pack for context
    const pack = await resolvePortfolioIntelligencePack({ bankId: bu.bank_id });

    const prompt = `You are an AI banking advisor providing a portfolio-level briefing to a bank team lead.
RULES:
- Only use facts from provided portfolio data.
- Do NOT invent statistics or market data.
- Be concise, professional, actionable.
- Focus on: what matters most, key risks, where to focus.

PORTFOLIO SUMMARY:
Total relationships: ${pack.summary.totalRelationships}
Watchlist: ${pack.summary.distressCounts.watchlist}
Workout: ${pack.summary.distressCounts.workout}
Upcoming deadlines: ${pack.summary.upcomingDeadlines}
Borrower blocked: ${pack.summary.borrowerBlocked}
Protection exposure: ${pack.summary.protectionExposure}
Growth opportunities: ${pack.summary.growthOpportunities}
Top risks: ${pack.summary.topRisks.join("; ") || "None"}

ACTIVE SIGNALS: ${pack.signals.map((s) => `${s.type} (${s.severity}): ${s.explanation}`).join("; ") || "None"}

TOP 5 RELATIONSHIPS: ${pack.orderedRelationships.slice(0, 5).map((r) => `${r.relationshipId} [${r.systemTier}]: ${r.explanation}`).join("; ") || "None"}

PORTFOLIO ACTIONS: ${pack.actions.map((a) => `${a.actionCode}: ${a.explanation}`).join("; ") || "None"}

Return ONLY valid JSON:
{
  "narrative": "2-3 paragraph portfolio briefing",
  "keyRisks": ["risk 1", "risk 2", "risk 3"],
  "focusRecommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}`;

    const text = await callOmegaGemini(prompt);
    const parsed = safeParseJSON(text, {
      narrative: "Portfolio briefing unavailable.",
      keyRisks: [],
      focusRecommendations: [],
    });

    return NextResponse.json({
      ok: true,
      advisory: {
        ...parsed,
        meta: {
          advisory: true,
          generatedAt: new Date().toISOString(),
          model: "gemini-2.0-flash",
        },
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
