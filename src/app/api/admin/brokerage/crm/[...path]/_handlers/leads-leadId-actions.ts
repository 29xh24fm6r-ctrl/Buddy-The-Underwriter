import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { transitionLeadStage, recordLeadContactAttempt } from "@/lib/leads/pipeline";
import { convertLeadToDeal, previewConvertLeadToDeal } from "@/lib/leads/convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/crm/leads/[leadId]/actions
 * Body: { action: "transition_stage" | "record_contact_attempt" | "convert", ... }
 *
 * A single dispatcher for the lead's audited commands — mirrors this
 * codebase's established catch-all-dispatcher pattern (ops/[...path],
 * workers/[...path]) rather than three near-identical route files for what
 * are all "do a controlled thing to this lead" actions. Each action still
 * gets its own validation and writes its own crm_activities entry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);
  const action = body?.action;

  try {
    switch (action) {
      case "transition_stage": {
        const lead = await transitionLeadStage({
          bankId: brokerageBankId,
          leadId,
          actorClerkUserId: userId,
          toStage: body?.toStage,
          reason: body?.reason ?? null,
          nextAction: body?.nextAction,
          nextActionDueAt: body?.nextActionDueAt,
        });
        return NextResponse.json({ ok: true, lead });
      }
      case "record_contact_attempt": {
        if (!["call", "email", "meeting"].includes(body?.channel)) {
          return NextResponse.json({ ok: false, error: "channel must be call, email, or meeting" }, { status: 400 });
        }
        if (!["no_answer", "left_message", "connected", "scheduled_followup"].includes(body?.outcome)) {
          return NextResponse.json({ ok: false, error: "invalid outcome" }, { status: 400 });
        }
        const lead = await recordLeadContactAttempt({
          bankId: brokerageBankId,
          leadId,
          actorClerkUserId: userId,
          channel: body.channel,
          outcome: body.outcome,
          notes: body?.notes ?? null,
        });
        return NextResponse.json({ ok: true, lead });
      }
      case "preview_convert": {
        const preview = await previewConvertLeadToDeal(brokerageBankId, leadId);
        return NextResponse.json({ ok: true, preview });
      }
      case "convert": {
        const result = await convertLeadToDeal({
          bankId: brokerageBankId,
          leadId,
          actorClerkUserId: userId,
          borrowerId: body?.borrowerId ?? null,
          dealName: body?.dealName ?? null,
        });
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ ok: false, error: "action must be transition_stage, record_contact_attempt, preview_convert, or convert" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
