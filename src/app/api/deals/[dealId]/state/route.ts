import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { getOmegaAdvisoryState } from "@/core/omega/OmegaAdvisoryAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { formatOmegaAdvisory } from "@/core/omega/formatOmegaAdvisory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // Derive explanation from canonical state (Buddy explains state)
    const explanation = deriveBuddyExplanation(state);

    // Format Omega advisory (Omega explains reasoning — separate)
    const omegaExplanation = formatOmegaAdvisory(omega);

    return NextResponse.json({
      ok: true,
      state,
      omega,
      explanation,
      omegaExplanation,
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/state] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal", reason: String(err) },
      { status: 500 },
    );
  }
}
