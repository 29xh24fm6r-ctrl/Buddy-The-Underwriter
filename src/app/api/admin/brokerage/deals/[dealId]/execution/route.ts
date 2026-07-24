import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { ALLOWED_TRANSITIONS, stageAgeDays, type BrokerageStage } from "@/lib/dealStage/stages";
import { assignDealStageOwner } from "@/lib/dealStage/transitions";
import { checkStageGate } from "@/lib/dealStage/gates";
import { listTasksForDeal } from "@/lib/tasks/tasks";
import { deriveBrokerageNextActions } from "@/lib/dealStage/nextActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/deals/[dealId]/execution
 *
 * The deal workspace summary (§5.6): current brokerage stage + age, tasks,
 * next-best-actions, and gate status for every stage the deal could move
 * to next. Extends the existing cockpit rather than duplicating it — this
 * is the data source for a panel mounted inside DealCockpitClient, not a
 * second cockpit page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: deal, error } = await sb
    .from("deals")
    .select("id, name, brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id")
    .eq("id", dealId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!deal) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const currentStage = (deal.brokerage_stage as BrokerageStage | null) ?? "intake";
  const candidateStages = ALLOWED_TRANSITIONS[currentStage] ?? [];

  const [tasks, nextActions, gateResults] = await Promise.all([
    listTasksForDeal(brokerageBankId, dealId, sb),
    deriveBrokerageNextActions(brokerageBankId, dealId, sb).catch(() => []),
    Promise.all(
      candidateStages.map(async (toStage) => ({
        toStage,
        ...(await checkStageGate(currentStage, toStage, dealId, sb)),
      })),
    ),
  ]);

  const stageAge = deal.brokerage_stage_entered_at ? stageAgeDays(deal.brokerage_stage_entered_at as string) : null;

  return NextResponse.json({
    ok: true,
    deal: { id: deal.id, name: deal.name, brokerageStage: currentStage, stageEnteredAt: deal.brokerage_stage_entered_at, stageOwnerClerkUserId: deal.brokerage_stage_owner_clerk_user_id, stageAgeDays: stageAge },
    candidateTransitions: gateResults,
    tasks,
    nextActions,
  });
}

/**
 * PATCH /api/admin/brokerage/deals/[dealId]/execution
 * Body: { ownerClerkUserId }
 * Simple field edit (stage owner assignment) — audited commands (stage
 * transitions, task actions) live under ./actions.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (!("ownerClerkUserId" in body)) {
    return NextResponse.json({ ok: false, error: "ownerClerkUserId is required" }, { status: 400 });
  }
  if (body.ownerClerkUserId !== null && typeof body.ownerClerkUserId !== "string") {
    return NextResponse.json({ ok: false, error: "ownerClerkUserId must be a string or null" }, { status: 400 });
  }

  try {
    await assignDealStageOwner({ bankId: brokerageBankId, dealId, ownerClerkUserId: body.ownerClerkUserId }, supabaseAdmin());
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
