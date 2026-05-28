import "server-only";

/**
 * POST /api/deals/[dealId]/flags/regenerate
 *
 * Regenerates risk flags for a deal using the current period-aligned flag engine.
 * Calls generateAndPersistFlags which:
 * 1. Builds flag engine input from deal_financial_facts
 * 2. Runs all flag modules (reconciliation, ratios, QoE, trends, documents)
 * 3. Upserts flags into deal_flags (creates new, updates existing)
 * 4. Deletes stale borrower questions when evidence gate suppresses
 *
 * Use when: flags are stale/missing after extraction or code fix.
 */

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const { generateAndPersistFlags } = await import(
      "@/lib/flagEngine/persistFlagReport"
    );

    const result = await generateAndPersistFlags(dealId, access.bankId);

    return NextResponse.json({
      ok: result.ok,
      flagCount: result.flagCount,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[flags/regenerate]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
