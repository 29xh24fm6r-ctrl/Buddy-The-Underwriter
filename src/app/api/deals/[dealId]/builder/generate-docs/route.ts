import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { validateBuilderGates } from "@/lib/builder/builderGateValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/builder/generate-docs
 * Server-gated doc generation launch. Only succeeds when doc_ready = true.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const gates = await validateBuilderGates(dealId);

  if (!gates.docReady) {
    await logLedgerEvent({
      dealId,
      bankId: auth.bankId,
      eventKey: "builder.generate_docs_blocked",
      uiState: "done",
      uiMessage: "Generate docs blocked",
      meta: { blockers: gates.docBlockers, actor: auth.userId },
    }).catch(() => {});

    return NextResponse.json({
      ok: false,
      error: "docs_not_ready",
      blockers: gates.docBlockers,
    }, { status: 422 });
  }

  const sb = supabaseAdmin();
  const { data: submission } = await sb
    .from("deal_builder_submissions")
    .insert({
      deal_id: dealId,
      submitted_by: auth.userId,
      submitted_from: "banker",
      submission_type: "docs_launch",
    })
    .select("id")
    .single();

  await logLedgerEvent({
    dealId,
    bankId: auth.bankId,
    eventKey: "builder.generate_docs_launched",
    uiState: "done",
    uiMessage: "Document generation launched",
    meta: { submission_id: submission?.id, actor: auth.userId },
  }).catch(() => {});

  return NextResponse.json({ ok: true, submissionId: submission?.id });
}
