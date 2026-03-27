import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { changeExceptionStatus } from "@/lib/policy/upsertDealPolicyExceptions";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const bankId = await getCurrentBankId();
    const body = await req.json();
    const { exceptionId, action, rationale, dealId } = body as {
      exceptionId: string;
      action: "approve" | "reject" | "escalate";
      rationale?: string;
      dealId?: string;
    };

    if (!exceptionId || !action) {
      return NextResponse.json(
        { ok: false, error: "validation_failed", reason: "exceptionId and action are required" },
        { status: 400 },
      );
    }

    const validActions = ["approve", "reject", "escalate"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { ok: false, error: "validation_failed", reason: `Invalid action: ${action}` },
        { status: 400 },
      );
    }

    // Map action to exception status
    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      escalate: "escalated",
    };
    const newStatus = statusMap[action];

    const sb = supabaseAdmin();

    // Verify exception belongs to this bank
    const { data: exception } = await sb
      .from("deal_policy_exceptions")
      .select("id, deal_id, status, bank_id")
      .eq("id", exceptionId)
      .maybeSingle();

    if (!exception) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    if (exception.bank_id && exception.bank_id !== bankId) {
      return NextResponse.json({ ok: false, error: "tenant_mismatch" }, { status: 403 });
    }

    const priorState = exception.status;

    // Execute decision
    const result = await changeExceptionStatus(
      sb,
      exceptionId,
      newStatus as any,
      userId,
      rationale,
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "invalid_state", reason: result.error },
        { status: 400 },
      );
    }

    // Write ledger event
    const effectiveDealId = dealId || exception.deal_id;
    if (effectiveDealId) {
      await writeEvent({
        dealId: effectiveDealId,
        kind: `exception.decision.${action}`,
        actorUserId: userId,
        action,
        meta: {
          surface_key: "exceptions_change_review",
          entity_type: "exception",
          entity_id: exceptionId,
          prior_state: priorState,
          next_state: newStatus,
          rationale,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      entityType: "exception",
      entityId: exceptionId,
      action,
      updatedState: { status: newStatus },
      transition: { from: priorState, to: newStatus },
    });
  } catch (err) {
    console.error("[POST /api/exceptions/decide] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal", reason: String(err) },
      { status: 500 },
    );
  }
}
