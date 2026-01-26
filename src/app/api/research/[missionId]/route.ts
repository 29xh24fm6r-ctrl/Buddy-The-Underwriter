/**
 * GET /api/research/[missionId]
 *
 * Fetch research mission results.
 *
 * Response:
 * {
 *   ok: boolean,
 *   mission?: { ... },
 *   sources?: [...],
 *   facts?: [...],
 *   inferences?: [...],
 *   narrative?: [...],
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ResearchMission,
  ResearchSource,
  ResearchFact,
  ResearchInference,
  NarrativeSection,
  FetchMissionResult,
} from "@/lib/research/types";

// Correlation ID for tracing
function getCorrelationId(): string {
  return `bre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-route": `GET /api/research/${missionId}`,
  };

  try {
    // Validate mission ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(missionId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid mission ID format" },
        { status: 200, headers }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Fetch mission
    const { data: mission, error: missionError } = await supabase
      .from("buddy_research_missions")
      .select("*")
      .eq("id", missionId)
      .single();

    if (missionError || !mission) {
      return NextResponse.json(
        { ok: false, error: "Mission not found" },
        { status: 200, headers }
      );
    }

    // If mission is still running, return just the mission status
    if (mission.status === "queued" || mission.status === "running") {
      return NextResponse.json(
        {
          ok: true,
          mission: {
            id: mission.id,
            deal_id: mission.deal_id,
            mission_type: mission.mission_type,
            subject: mission.subject,
            depth: mission.depth,
            status: mission.status,
            sources_count: mission.sources_count,
            facts_count: mission.facts_count,
            inferences_count: mission.inferences_count,
            created_at: mission.created_at,
            started_at: mission.started_at,
          },
        },
        { status: 200, headers }
      );
    }

    // Fetch all related data in parallel
    const [sourcesResult, factsResult, inferencesResult, narrativeResult] = await Promise.all([
      supabase
        .from("buddy_research_sources")
        .select("id, source_class, source_name, source_url, retrieved_at, http_status, fetch_error")
        .eq("mission_id", missionId)
        .order("retrieved_at", { ascending: true }),

      supabase
        .from("buddy_research_facts")
        .select("*")
        .eq("mission_id", missionId)
        .order("extracted_at", { ascending: true }),

      supabase
        .from("buddy_research_inferences")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true }),

      supabase
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", missionId)
        .single(),
    ]);

    // Build response
    const response: FetchMissionResult = {
      ok: true,
      mission: {
        id: mission.id,
        deal_id: mission.deal_id,
        bank_id: mission.bank_id,
        mission_type: mission.mission_type,
        subject: mission.subject,
        depth: mission.depth,
        status: mission.status,
        error_message: mission.error_message,
        sources_count: mission.sources_count,
        facts_count: mission.facts_count,
        inferences_count: mission.inferences_count,
        created_at: mission.created_at,
        started_at: mission.started_at,
        completed_at: mission.completed_at,
        created_by: mission.created_by,
        correlation_id: mission.correlation_id,
      },
      sources: sourcesResult.data?.map((s: { id: string; source_class: string; source_name: string; source_url: string; retrieved_at: string }) => ({
        id: s.id,
        source_class: s.source_class as "government" | "regulatory" | "industry" | "company" | "geography" | "news",
        source_name: s.source_name,
        source_url: s.source_url,
        retrieved_at: s.retrieved_at,
      })) ?? [],
      facts: factsResult.data ?? [],
      inferences: inferencesResult.data ?? [],
      narrative: narrativeResult.data?.sections ?? [],
    };

    return NextResponse.json(response, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Research fetch error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 200, headers }
    );
  }
}
