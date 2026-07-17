import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";
import { transitionDealStage } from "@/lib/dealStage/transitions";
import { createTask, updateTaskStatus, updateTaskFields } from "@/lib/tasks/tasks";
import { generateStageTaskPlan } from "@/lib/tasks/stagePlans";
import { TASK_CATEGORIES } from "@/lib/tasks/types";
import { isValidBrokerageStage } from "@/lib/dealStage/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/deals/[dealId]/execution/actions
 * Body: { action: "transition_stage" | "create_task" | "update_task" | "generate_stage_plan", ... }
 *
 * One dispatcher for the deal's audited commands — mirrors the pattern
 * already used for leads (PR2) and this codebase's ops/[...path] catch-all
 * precedent, rather than four near-identical route files.
 *
 * Overrides (transition_stage with override:true) require an authorized
 * role (bank_admin or super_admin on the brokerage tenant — not plain
 * underwriter) per §5.2 "Authorized role, Reason, Missing requirements,
 * Audit event."
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}) as any);
  const action = body?.action;

  try {
    switch (action) {
      case "transition_stage": {
        if (!isValidBrokerageStage(body?.toStage)) {
          return NextResponse.json({ ok: false, error: "toStage is required and must be a valid brokerage stage" }, { status: 400 });
        }

        if (body?.override) {
          const { data: membership } = await sb
            .from("bank_memberships")
            .select("role")
            .eq("bank_id", brokerageBankId)
            .eq("clerk_user_id", userId)
            .maybeSingle();
          const role = normalizeBuddyRole(membership?.role);
          if (role !== "bank_admin" && role !== "super_admin") {
            return NextResponse.json({ ok: false, error: "forbidden", message: "Stage overrides require bank_admin or super_admin." }, { status: 403 });
          }
        }

        const result = await transitionDealStage(
          {
            bankId: brokerageBankId,
            dealId,
            actorClerkUserId: userId,
            toStage: body.toStage,
            reason: body?.reason ?? null,
            override: !!body?.override,
          },
          sb,
        );
        return NextResponse.json({ ok: true, deal: result.deal, wasOverride: result.wasOverride });
      }
      case "create_task": {
        if (!(TASK_CATEGORIES as readonly string[]).includes(body?.category)) {
          return NextResponse.json({ ok: false, error: `category must be one of: ${TASK_CATEGORIES.join(", ")}` }, { status: 400 });
        }
        if (typeof body?.title !== "string" || !body.title.trim()) {
          return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
        }
        const task = await createTask(
          {
            bankId: brokerageBankId,
            title: body.title,
            description: body?.description ?? null,
            category: body.category,
            dealId,
            assignedToClerkUserId: body?.assignedToClerkUserId ?? null,
            assignedRole: body?.assignedRole ?? null,
            priority: body?.priority ?? undefined,
            dueAt: body?.dueAt ?? null,
            blocking: !!body?.blocking,
            createdByClerkUserId: userId,
          },
          sb,
        );
        return NextResponse.json({ ok: true, task });
      }
      case "update_task": {
        if (typeof body?.taskId !== "string") {
          return NextResponse.json({ ok: false, error: "taskId is required" }, { status: 400 });
        }
        let task;
        if (body?.status) {
          task = await updateTaskStatus(
            { bankId: brokerageBankId, taskId: body.taskId, status: body.status, actorClerkUserId: userId, completionOutcome: body?.completionOutcome ?? null },
            sb,
          );
        } else {
          task = await updateTaskFields(
            {
              bankId: brokerageBankId,
              taskId: body.taskId,
              title: body?.title,
              description: body?.description,
              assignedToClerkUserId: body?.assignedToClerkUserId,
              assignedRole: body?.assignedRole,
              priority: body?.priority,
              dueAt: body?.dueAt,
              escalationState: body?.escalationState,
            },
            sb,
          );
        }
        return NextResponse.json({ ok: true, task });
      }
      case "generate_stage_plan": {
        if (!isValidBrokerageStage(body?.stage)) {
          return NextResponse.json({ ok: false, error: "stage is required and must be a valid brokerage stage" }, { status: 400 });
        }
        const result = await generateStageTaskPlan(brokerageBankId, dealId, body.stage, userId, sb);
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ ok: false, error: "action must be transition_stage, create_task, update_task, or generate_stage_plan" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
