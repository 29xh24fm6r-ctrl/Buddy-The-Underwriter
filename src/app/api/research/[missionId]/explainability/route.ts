/**
 * GET /api/research/[missionId]/explainability
 *
 * Get explainability graph for a research mission.
 *
 * Response:
 * {
 *   ok: boolean,
 *   nodes: [...],
 *   edges: [...],
 *   integrity: { valid: boolean, violations: [...] },
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildExplainabilityGraph,
  validateExplainabilityGraph,
  assertMissionIntegrity,
  type ExplainabilityGraph,
  type MissionIntegrityResult,
} from "@/lib/research/integrity";
import type {
  ResearchMission,
  ResearchSource,
  ResearchFact,
  ResearchInference,
  NarrativeSection,
} from "@/lib/research/types";

// Correlation ID for tracing
function getCorrelationId(): string {
  return `bre-explain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type ExplainabilityResponse = {
  ok: boolean;
  nodes?: ExplainabilityGraph["nodes"];
  edges?: ExplainabilityGraph["edges"];
  integrity?: {
    valid: boolean;
    violations: MissionIntegrityResult["violations"];
    warnings: MissionIntegrityResult["warnings"];
  };
  summary?: MissionIntegrityResult["summary"];
  error?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-buddy-route": `GET /api/research/${missionId}/explainability`,
  };

  try {
    // Validate mission ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(missionId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid mission ID format" },
        { status: 400, headers }
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
        { status: 404, headers }
      );
    }

    // Fetch all related data in parallel
    const [sourcesResult, factsResult, inferencesResult, narrativeResult] = await Promise.all([
      supabase
        .from("buddy_research_sources")
        .select("*")
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

    const sources = (sourcesResult.data ?? []) as ResearchSource[];
    const facts = (factsResult.data ?? []) as ResearchFact[];
    const inferences = (inferencesResult.data ?? []) as ResearchInference[];
    const narrative = (narrativeResult.data?.sections ?? []) as NarrativeSection[];

    // Build explainability graph
    const graph = buildExplainabilityGraph({
      mission: mission as ResearchMission,
      sources,
      facts,
      inferences,
      narrative,
    });

    // Validate graph
    const graphValidation = validateExplainabilityGraph(graph);

    // Run integrity checks
    const integrityResult = assertMissionIntegrity({
      mission: mission as ResearchMission,
      sources,
      facts,
      inferences,
      narrative,
    });

    const response: ExplainabilityResponse = {
      ok: true,
      nodes: graph.nodes,
      edges: graph.edges,
      integrity: {
        valid: integrityResult.ok && graphValidation.valid,
        violations: integrityResult.violations,
        warnings: integrityResult.warnings,
      },
      summary: integrityResult.summary,
    };

    return NextResponse.json(response, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Explainability error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers }
    );
  }
}
