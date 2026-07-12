/**
 * POST /api/research/planner/approve
 *
 * Approve or reject a specific mission in a plan.
 *
 * Request body:
 * {
 *   plan_id: string,
 *   mission_index: number,
 *   approved: boolean
 * }
 *
 * Response:
 * {
 *   ok: boolean,
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { approveMission } from "@/lib/research/planner/runPlanner";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

function getCorrelationId(): string {
  return `arp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-route": "POST /api/research/planner/approve",
  };

  try {
    const body = await request.json();

    // Validate plan_id
    if (!body.plan_id || typeof body.plan_id !== "string") {
      return NextResponse.json(
        { ok: false, error: "plan_id is required" },
        { status: 200, headers }
      );
    }

    // Validate mission_index
    if (typeof body.mission_index !== "number" || body.mission_index < 0) {
      return NextResponse.json(
        { ok: false, error: "mission_index must be a non-negative number" },
        { status: 200, headers }
      );
    }

    // Validate approved
    if (typeof body.approved !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "approved must be a boolean" },
        { status: 200, headers }
      );
    }

    // SECURITY: this route can trigger real mission execution (approveMission
    // -> executeApprovedMissions) and previously trusted a client-supplied
    // user_id for audit attribution with no session validation, and no check
    // that the caller's bank owns the plan being approved. See
    // specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-1.
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers }
      );
    }

    const callerBankId = await getCurrentBankId();
    const sb = supabaseAdmin();
    const { data: plan } = await sb
      .from("buddy_research_plans")
      .select("id, bank_id")
      .eq("id", body.plan_id)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json(
        { ok: false, error: "plan_not_found" },
        { status: 404, headers }
      );
    }
    if (plan.bank_id !== callerBankId) {
      console.warn("[planner/approve] TENANT MISMATCH", { planId: body.plan_id, callerBankId, planBankId: plan.bank_id });
      return NextResponse.json(
        { ok: false, error: "tenant_mismatch" },
        { status: 403, headers }
      );
    }

    const result = await approveMission(
      body.plan_id,
      body.mission_index,
      body.approved,
      userId
    );

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Approve mission error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 200, headers }
    );
  }
}
