/**
 * POST /api/research/start
 *
 * Start a new research mission for a deal.
 *
 * Request body:
 * {
 *   deal_id: string,
 *   mission_type: "industry_landscape" | "competitive_analysis",
 *   subject: { naics_code?: string, geography?: string, ... },
 *   depth?: "overview" | "committee" | "deep_dive"
 * }
 *
 * Response:
 * {
 *   ok: boolean,
 *   mission_id?: string,
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runMission } from "@/lib/research/runMission";
import { isValidNaicsCode } from "@/lib/research/sourceDiscovery";
import type { MissionType, MissionSubject, MissionDepth } from "@/lib/research/types";

// Correlation ID for tracing
function getCorrelationId(): string {
  return `bre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-route": "POST /api/research/start",
  };

  try {
    // Parse request body
    const body = await request.json();

    // Validate required fields
    if (!body.deal_id || typeof body.deal_id !== "string") {
      return NextResponse.json(
        { ok: false, error: "deal_id is required" },
        { status: 200, headers }
      );
    }

    if (!body.mission_type || typeof body.mission_type !== "string") {
      return NextResponse.json(
        { ok: false, error: "mission_type is required" },
        { status: 200, headers }
      );
    }

    // Validate mission type
    const validMissionTypes: MissionType[] = [
      "industry_landscape",
      "competitive_analysis",
      "market_demand",
      "demographics",
      "regulatory_environment",
      "management_backgrounds",
    ];

    if (!validMissionTypes.includes(body.mission_type as MissionType)) {
      return NextResponse.json(
        { ok: false, error: `Invalid mission_type. Must be one of: ${validMissionTypes.join(", ")}` },
        { status: 200, headers }
      );
    }

    const missionType = body.mission_type as MissionType;

    // Validate subject
    const subject: MissionSubject = body.subject ?? {};

    // For industry_landscape and competitive_analysis, NAICS code is required
    if (
      (missionType === "industry_landscape" || missionType === "competitive_analysis") &&
      !subject.naics_code
    ) {
      return NextResponse.json(
        { ok: false, error: "subject.naics_code is required for industry_landscape and competitive_analysis missions" },
        { status: 200, headers }
      );
    }

    // Validate NAICS code format
    if (subject.naics_code && !isValidNaicsCode(subject.naics_code)) {
      return NextResponse.json(
        { ok: false, error: "Invalid NAICS code format. Must be 2-6 digits." },
        { status: 200, headers }
      );
    }

    // Validate depth
    const validDepths: MissionDepth[] = ["overview", "committee", "deep_dive"];
    const depth: MissionDepth = validDepths.includes(body.depth) ? body.depth : "overview";

    // Get authenticated user (optional for now)
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Get user's bank_id if available
    let bankId: string | null = null;
    if (user) {
      const { data: profile } = await supabase
        .from("users")
        .select("bank_id")
        .eq("id", user.id)
        .single();
      bankId = profile?.bank_id ?? null;
    }

    // Verify deal exists and user has access
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id, bank_id")
      .eq("id", body.deal_id)
      .single();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found or access denied" },
        { status: 200, headers }
      );
    }

    // Run the mission (this will be async in production, but for now we run synchronously)
    // In production, this would queue the mission and return immediately
    const result = await runMission(body.deal_id, missionType, subject, {
      depth,
      bankId: deal.bank_id,
      userId: user?.id,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        mission_id: result.mission_id,
        sources_count: result.sources_count,
        facts_count: result.facts_count,
        inferences_count: result.inferences_count,
        narrative_sections: result.narrative_sections,
        duration_ms: result.duration_ms,
        error: result.error,
      },
      { status: 200, headers }
    );
  } catch (error) {
    console.error(`[${correlationId}] Research start error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 200, headers }
    );
  }
}
