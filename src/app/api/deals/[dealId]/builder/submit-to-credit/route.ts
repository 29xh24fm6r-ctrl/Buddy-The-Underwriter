import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { validateBuilderGates } from "@/lib/builder/builderGateValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/builder/submit-to-credit
 * Server-gated credit submission. Only succeeds when credit_ready = true.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const gates = await validateBuilderGates(dealId);

  if (!gates.creditReady) {
    await logLedgerEvent({
      dealId,
      bankId: auth.bankId,
      eventKey: "builder.submit_to_credit_blocked",
      uiState: "done",
      uiMessage: "Submit to credit blocked",
      meta: { blockers: gates.creditBlockers, actor: auth.userId },
    }).catch(() => {});

    return NextResponse.json({
      ok: false,
      error: "credit_not_ready",
      blockers: gates.creditBlockers,
    }, { status: 422 });
  }

  const sb = supabaseAdmin();
  const { data: submission } = await sb
    .from("deal_builder_submissions")
    .insert({
      deal_id: dealId,
      submitted_by: auth.userId,
      submitted_from: "banker",
      submission_type: "credit",
    })
    .select("id")
    .single();

  await logLedgerEvent({
    dealId,
    bankId: auth.bankId,
    eventKey: "builder.submit_to_credit_submitted",
    uiState: "done",
    uiMessage: "Deal submitted to credit",
    meta: { submission_id: submission?.id, actor: auth.userId },
  }).catch(() => {});

  return NextResponse.json({ ok: true, submissionId: submission?.id });
}
