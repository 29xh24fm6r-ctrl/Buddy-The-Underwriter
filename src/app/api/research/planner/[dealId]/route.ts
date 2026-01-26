/**
 * GET /api/research/planner/[dealId]
 *
 * Get the current research plan for a deal.
 *
 * Response:
 * {
 *   ok: boolean,
 *   plan?: ResearchPlan,
 *   intent_logs?: ResearchIntentLog[],
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlan } from "@/lib/research/planner/runPlanner";

function getCorrelationId(): string {
  return `arp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-route": `GET /api/research/planner/${dealId}`,
  };

  try {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid deal ID format" },
        { status: 200, headers }
      );
    }

    const result = await getCurrentPlan(dealId);

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Get plan error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 200, headers }
    );
  }
}
