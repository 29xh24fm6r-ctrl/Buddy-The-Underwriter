import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { getOmegaAdvisoryState } from "@/core/omega/OmegaAdvisoryAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { formatOmegaAdvisory } from "@/core/omega/formatOmegaAdvisory";
import { deriveNextActions } from "@/core/actions/deriveNextActions";

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

    const [state, omega] = await Promise.all([
      getBuddyCanonicalState(dealId),
      getOmegaAdvisoryState(dealId),
    ]);

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
