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

    const result = await approveMission(
      body.plan_id,
      body.mission_index,
      body.approved,
      body.user_id
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
