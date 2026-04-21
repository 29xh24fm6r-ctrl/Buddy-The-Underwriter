import "server-only";

// src/app/api/deals/[dealId]/sba/draft-assumptions/route.ts
// Phase 3 — Generate AI-drafted SBA assumptions from all available deal
// context (financials + research + ownership + benchmarks). The interview
// renders these as section cards for the borrower to approve or tweak.
// Bank-tenant gated; no SBA deal-type gate (works for any deal that wants
// projections, regardless of loan type).

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { draftAssumptionsFromContext } from "@/lib/sba/sbaAssumptionDrafter";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function POST(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: 403 },
    );
  }

  try {
    const drafted = await draftAssumptionsFromContext(dealId);

    // Surface prefillMeta separately so the UI can show NAICS + source badges
    // alongside the AI-drafted reasoning. Best-effort — never blocking.
    let prefillMeta: unknown = null;
    try {
      const prefill = await loadSBAAssumptionsPrefill(dealId);
      prefillMeta = prefill._prefillMeta ?? null;
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      assumptions: drafted.assumptions,
      reasoning: drafted.reasoning,
      prefillMeta,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to draft assumptions";
    console.error("[sba/draft-assumptions]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
