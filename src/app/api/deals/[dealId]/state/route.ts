import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { getOmegaAdvisoryState, synthesizeAdvisoryFromRisk } from "@/core/omega/OmegaAdvisoryAdapter";
import type { AiRiskResult } from "@/core/omega/OmegaAdvisoryAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { formatOmegaAdvisory } from "@/core/omega/formatOmegaAdvisory";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const [state, omegaRaw] = await Promise.all([
      getBuddyCanonicalState(dealId),
      getOmegaAdvisoryState(dealId),
    ]);

    // If Pulse returned stale, try local ai_risk_runs fallback
    let omega = omegaRaw;
    if (omega.stale) {
      try {
        const sb = supabaseAdmin();
        const { data } = await sb
          .from("ai_risk_runs")
          .select("result_json")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.result_json) {
          omega = synthesizeAdvisoryFromRisk(data.result_json as AiRiskResult);
        }
      } catch {
        // Keep stale omega — fallback is best-effort
      }
    }

    // Derive explanation (Buddy explains state)
    const explanation = deriveBuddyExplanation(state);

    // Derive next actions from canonical state + explanation
    const { nextActions, primaryAction } = deriveNextActions({
      canonicalState: state,
      explanation,
    });

    // Format Omega advisory (separate from Buddy explanation)
    const omegaExplanation = formatOmegaAdvisory(omega);

    return NextResponse.json({
      ok: true,
      state,
      omega,
      explanation,
      omegaExplanation,
      nextActions,
      primaryAction,
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/state] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal", reason: String(err) },
      { status: 500 },
    );
  }
}
