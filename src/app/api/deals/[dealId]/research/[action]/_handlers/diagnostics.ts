/**
 * GET /api/deals/[dealId]/research/diagnostics
 *
 * Get research diagnostics bundle for a deal.
 * Provides:
 * - Last 5 missions with status and durations
 * - Last 20 sources with domains and checksums
 * - Last 20 degraded events
 * - Correlation IDs for tracing
 *
 * Response designed to be copy-pasteable for support.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Correlation ID for tracing
function getCorrelationId(): string {
  return `bre-diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type DiagnosticsMission = {
  id: string;
  mission_type: string;
  status: string;
  duration_seconds?: number;
  sources_count: number;
  facts_count: number;
  inferences_count: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  correlation_id?: string;
};

export type DiagnosticsSource = {
  id: string;
  mission_id: string;
  source_name: string;
  domain: string;
  checksum_prefix: string;
  http_status?: number;
  fetch_duration_ms?: number;
  fetch_error?: string;
  retrieved_at: string;
};

export type DiagnosticsEvent = {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  message?: string;
  created_at: string;
};

export type DiagnosticsBundle = {
  ok: boolean;
  deal_id: string;
  generated_at: string;
  correlation_id: string;
  missions: DiagnosticsMission[];
  sources: DiagnosticsSource[];
  degraded_events: DiagnosticsEvent[];
  summary: {
    total_missions: number;
    complete_missions: number;
    failed_missions: number;
    total_sources: number;
    total_facts: number;
    total_inferences: number;
    avg_mission_duration_seconds?: number;
  };
  copyable_text: string;
  error?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-buddy-route": `GET /api/deals/${dealId}/research/diagnostics`,
  };

  try {
    // Validate deal ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid deal ID format" },
        { status: 400, headers }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Fetch last 5 missions
    const { data: missionsData } = await supabase
      .from("buddy_research_missions")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(5);

    const missions: DiagnosticsMission[] = (missionsData ?? []).map((m: {
      id: string;
      mission_type: string;
      status: string;
      sources_count: number;
      facts_count: number;
      inferences_count: number;
      created_at: string;
      completed_at?: string;
      started_at?: string;
      error_message?: string;
      correlation_id?: string;
    }) => {
      let durationSeconds: number | undefined;
      if (m.completed_at && m.started_at) {
        const start = new Date(m.started_at).getTime();
        const end = new Date(m.completed_at).getTime();
        durationSeconds = (end - start) / 1000;
      }

      return {
        id: m.id,
        mission_type: m.mission_type,
        status: m.status,
        duration_seconds: durationSeconds,
        sources_count: m.sources_count,
        facts_count: m.facts_count,
        inferences_count: m.inferences_count,
        created_at: m.created_at,
        completed_at: m.completed_at,
        error_message: m.error_message,
        correlation_id: m.correlation_id,
      };
    });

    // Get mission IDs for source lookup
    const missionIds = missions.map((m) => m.id);

    // Fetch last 20 sources across these missions
    const { data: sourcesData } = missionIds.length > 0
      ? await supabase
          .from("buddy_research_sources")
          .select("*")
          .in("mission_id", missionIds)
          .order("retrieved_at", { ascending: false })
          .limit(20)
      : { data: [] };

    const sources: DiagnosticsSource[] = (sourcesData ?? []).map((s: {
      id: string;
      mission_id: string;
      source_name: string;
      source_url: string;
      checksum?: string;
      http_status?: number;
      fetch_duration_ms?: number;
      fetch_error?: string;
      retrieved_at: string;
    }) => {
      let domain = "unknown";
      try {
        domain = new URL(s.source_url).hostname;
      } catch {
        // URL parsing failed
      }

      return {
        id: s.id,
        mission_id: s.mission_id,
        source_name: s.source_name,
        domain,
        checksum_prefix: s.checksum?.slice(0, 8) ?? "N/A",
        http_status: s.http_status,
        fetch_duration_ms: s.fetch_duration_ms,
        fetch_error: s.fetch_error,
        retrieved_at: s.retrieved_at,
      };
    });

    // Fetch last 20 degraded events (from buddy_intel_events)
    const { data: eventsData } = await supabase
      .from("buddy_intel_events")
      .select("*")
      .eq("deal_id", dealId)
      .in("severity", ["warn", "danger"])
      .order("created_at", { ascending: false })
      .limit(20);

    const degradedEvents: DiagnosticsEvent[] = (eventsData ?? []).map((e: {
      id: string;
      event_type: string;
      severity: string;
      title: string;
      message?: string;
      created_at: string;
    }) => ({
      id: e.id,
      event_type: e.event_type,
      severity: e.severity,
      title: e.title,
      message: e.message,
      created_at: e.created_at,
    }));

    // Calculate summary
    const completeMissions = missions.filter((m) => m.status === "complete").length;
    const failedMissions = missions.filter((m) => m.status === "failed").length;
    const durations = missions
      .filter((m) => m.duration_seconds !== undefined)
      .map((m) => m.duration_seconds!);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : undefined;

    const totalFacts = missions.reduce((sum, m) => sum + m.facts_count, 0);
    const totalInferences = missions.reduce((sum, m) => sum + m.inferences_count, 0);

    const summary = {
      total_missions: missions.length,
      complete_missions: completeMissions,
      failed_missions: failedMissions,
      total_sources: sources.length,
      total_facts: totalFacts,
      total_inferences: totalInferences,
      avg_mission_duration_seconds: avgDuration,
    };

    // Generate copyable text
    const copyableText = generateCopyableText(
      dealId,
      correlationId,
      missions,
      sources,
      degradedEvents,
      summary
    );

    const bundle: DiagnosticsBundle = {
      ok: true,
      deal_id: dealId,
      generated_at: new Date().toISOString(),
      correlation_id: correlationId,
      missions,
      sources,
      degraded_events: degradedEvents,
      summary,
      copyable_text: copyableText,
    };

    return NextResponse.json(bundle, { status: 200, headers });
  } catch (error) {
    console.error(`[${correlationId}] Diagnostics error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers }
    );
  }
}

function generateCopyableText(
  dealId: string,
  correlationId: string,
  missions: DiagnosticsMission[],
  sources: DiagnosticsSource[],
  events: DiagnosticsEvent[],
  summary: DiagnosticsBundle["summary"]
): string {
  const lines: string[] = [
    "=== BUDDY RESEARCH DIAGNOSTICS ===",
    `Deal ID: ${dealId}`,
    `Generated: ${new Date().toISOString()}`,
    `Correlation ID: ${correlationId}`,
    "",
    "--- SUMMARY ---",
    `Missions: ${summary.complete_missions}/${summary.total_missions} complete, ${summary.failed_missions} failed`,
    `Sources: ${summary.total_sources}`,
    `Facts: ${summary.total_facts}`,
    `Inferences: ${summary.total_inferences}`,
    summary.avg_mission_duration_seconds
      ? `Avg Duration: ${summary.avg_mission_duration_seconds.toFixed(1)}s`
      : "Avg Duration: N/A",
    "",
    "--- MISSIONS ---",
  ];

  for (const m of missions) {
    lines.push(
      `[${m.status.toUpperCase()}] ${m.mission_type} | ${m.duration_seconds?.toFixed(1) ?? "?"}s | ` +
      `${m.sources_count}src/${m.facts_count}facts/${m.inferences_count}inf`
    );
    if (m.error_message) {
      lines.push(`  ERROR: ${m.error_message}`);
    }
    if (m.correlation_id) {
      lines.push(`  CID: ${m.correlation_id}`);
    }
  }

  lines.push("");
  lines.push("--- SOURCES (last 20) ---");

  for (const s of sources.slice(0, 10)) {
    const status = s.fetch_error
      ? `ERR: ${s.fetch_error.slice(0, 30)}`
      : `HTTP ${s.http_status ?? "?"} | ${s.fetch_duration_ms ?? "?"}ms`;
    lines.push(`${s.domain} | ${s.checksum_prefix} | ${status}`);
  }

  if (events.length > 0) {
    lines.push("");
    lines.push("--- DEGRADED EVENTS ---");
    for (const e of events.slice(0, 5)) {
      lines.push(`[${e.severity.toUpperCase()}] ${e.event_type}: ${e.title}`);
    }
  }

  lines.push("");
  lines.push("=== END DIAGNOSTICS ===");

  return lines.join("\n");
}
