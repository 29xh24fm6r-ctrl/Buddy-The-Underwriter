/**
 * POST /api/research/planner/evaluate
 *
 * Evaluate and create a research plan for a deal.
 * This triggers autonomous research planning.
 *
 * Request body:
 * {
 *   deal_id: string,
 *   trigger_event: "document_uploaded" | "checklist_updated" | ...,
 *   trigger_document_id?: string,
 *   trigger_mission_id?: string,
 *   auto_approve?: boolean,  // default true
 *   auto_execute?: boolean   // default true
 * }
 *
 * Response:
 * {
 *   ok: boolean,
 *   plan_id?: string,
 *   proposed_count: number,
 *   approved: boolean,
 *   executing: boolean,
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { evaluateResearchPlan } from "@/lib/research/planner/runPlanner";
import type { PlanTriggerEvent } from "@/lib/research/planner/types";

function getCorrelationId(): string {
  return `arp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_TRIGGER_EVENTS: PlanTriggerEvent[] = [
  "document_uploaded",
  "checklist_updated",
  "stance_changed",
  "mission_completed",
  "manual_request",
  "initial_evaluation",
];

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-route": "POST /api/research/planner/evaluate",
  };

  try {
    const body = await request.json();

    // Validate deal_id
    if (!body.deal_id || typeof body.deal_id !== "string") {
      return NextResponse.json(
        { ok: false, proposed_count: 0, approved: false, executing: false, error: "deal_id is required" },
        { status: 200, headers }
      );
    }

    // Validate trigger_event
    const triggerEvent = body.trigger_event ?? "manual_request";
    if (!VALID_TRIGGER_EVENTS.includes(triggerEvent)) {
      return NextResponse.json(
        {
          ok: false,
          proposed_count: 0,
          approved: false,
          executing: false,
          error: `Invalid trigger_event. Must be one of: ${VALID_TRIGGER_EVENTS.join(", ")}`,
        },
        { status: 200, headers }
      );
    }

    // Run evaluation
    const result = await evaluateResearchPlan({
      deal_id: body.deal_id,
      trigger_event: triggerEvent,
      trigger_document_id: body.trigger_document_id,
      trigger_mission_id: body.trigger_mission_id,
      auto_approve: body.auto_approve ?? true,
      auto_execute: body.auto_execute ?? true,
    });

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Planner evaluate error:`, error);

    return NextResponse.json(
      {
        ok: false,
        proposed_count: 0,
        approved: false,
        executing: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 200, headers }
    );
  }
}
