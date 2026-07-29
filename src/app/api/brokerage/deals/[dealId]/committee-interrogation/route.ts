import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/committee-interrogation
 *
 * SPEC-M6 ANTICIPATED-INTERROGATION-1 — banker-triggered re-run of the
 * hostile-committee interrogation. The seal route already runs this
 * automatically (best-effort, non-fatal) right after a deal seals; this
 * endpoint exists so a banker can regenerate the appendix later — e.g.
 * after new documents land that answer a previously-open question —
 * without unsealing and re-sealing the deal.
 *
 * Bank-staff auth only (requireUser + ensureDealBankAccess), same pattern
 * as src/app/api/deals/[dealId]/activity/route.ts — this is a banker
 * work-item generator, never borrower- or lender-facing.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runHostileInterrogationForDeal } from "@/lib/brokerage/hostileInterrogation";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  try {
    const result = await runHostileInterrogationForDeal(dealId, access.bankId, sb);
    return NextResponse.json({
      ok: true,
      questionCount: result.questions.length,
      conditionsCreated: result.conditionsCreated,
      conditionsSkipped: result.conditionsSkipped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[committee-interrogation] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
