/**
 * GET /api/research/[missionId]/export
 *
 * Export research mission as PDF, DOCX, or Markdown.
 *
 * Query params:
 * - format: "pdf" | "docx" | "markdown" (default: "pdf")
 *
 * Response:
 * - PDF/DOCX/Markdown file download
 * - Or JSON error if format not supported
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { renderPackToMarkdown, compileCreditCommitteePack } from "@/lib/research/creditCommitteePack";
import { generateDocument } from "@/lib/research/export/generateDocuments";
import type {
  ResearchMission,
  ResearchFact,
  ResearchInference,
  ResearchSource,
} from "@/lib/research/types";

// Correlation ID for tracing
function getCorrelationId(): string {
  return `bre-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;
  const correlationId = getCorrelationId();
  const headers = {
    "x-correlation-id": correlationId,
    "x-buddy-route": `GET /api/research/${missionId}/export`,
  };

  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "pdf";

    if (format !== "pdf" && format !== "docx" && format !== "markdown") {
      return NextResponse.json(
        { ok: false, error: `Unsupported format: ${format}. Use pdf, docx, or markdown.` },
        { status: 400, headers }
      );
    }

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

    if (mission.status !== "complete") {
      return NextResponse.json(
        { ok: false, error: "Mission not yet complete" },
        { status: 400, headers }
      );
    }

    // Fetch all related data
    const [sourcesResult, factsResult, inferencesResult] = await Promise.all([
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
    ]);

    const sources = sourcesResult.data ?? [];
    const facts = factsResult.data ?? [];
    const inferences = inferencesResult.data ?? [];

    // Compile credit committee pack
    const packResult = compileCreditCommitteePack({
      deal_id: mission.deal_id,
      missions: [
        {
          mission: mission as ResearchMission,
          facts: facts as ResearchFact[],
          inferences: inferences as ResearchInference[],
          sources: sources as ResearchSource[],
        },
      ],
    });

    if (!packResult.ok || !packResult.pack) {
      return NextResponse.json(
        { ok: false, error: packResult.error ?? "Failed to compile pack" },
        { status: 500, headers }
      );
    }

    // Generate markdown (base for all formats)
    const markdown = renderPackToMarkdown(packResult.pack);

    // Add source appendix with checksums
    const appendix = generateSourceAppendix(sources as ResearchSource[]);
    const fullMarkdown = markdown + "\n\n" + appendix;

    if (format === "markdown") {
      return new NextResponse(fullMarkdown, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="research-${missionId.slice(0, 8)}.md"`,
        },
      });
    }

    // Generate PDF or DOCX using the document generation module
    if (format === "pdf" || format === "docx") {
      // Get deal name for filename
      const { data: deal } = await supabase
        .from("deals")
        .select("company_name")
        .eq("id", mission.deal_id)
        .single();

      const docResult = await generateDocument({
        pack: packResult.pack,
        sources: sources as ResearchSource[],
        format,
        missionId,
        dealName: deal?.company_name,
        generatedAt: new Date().toISOString(),
      });

      if (!docResult.ok || !docResult.buffer) {
        return NextResponse.json(
          { ok: false, error: docResult.error ?? "Document generation failed" },
          { status: 500, headers }
        );
      }

      // Convert Buffer to Uint8Array for NextResponse compatibility
      const bodyData = new Uint8Array(docResult.buffer);
      return new NextResponse(bodyData, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": docResult.contentType!,
          "Content-Disposition": `attachment; filename="${docResult.filename}"`,
          "Content-Length": String(docResult.buffer.length),
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown format" },
      { status: 400, headers }
    );
  } catch (error) {
    console.error(`[${correlationId}] Export error:`, error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers }
    );
  }
}

/**
 * Generate source appendix with checksums and retrieval times.
 */
function generateSourceAppendix(sources: ResearchSource[]): string {
  const lines: string[] = [
    "---",
    "",
    "## Appendix: Source List",
    "",
    "| # | Source | URL | Retrieved | Checksum |",
    "|---|--------|-----|-----------|----------|",
  ];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const checksumPrefix = source.checksum?.slice(0, 8) ?? "N/A";
    const retrieved = source.retrieved_at
      ? new Date(source.retrieved_at).toISOString().slice(0, 16).replace("T", " ")
      : "N/A";

    lines.push(
      `| ${i + 1} | ${source.source_name} | ${truncateUrl(source.source_url, 50)} | ${retrieved} | ${checksumPrefix} |`
    );
  }

  lines.push("");
  lines.push("*Checksum: First 8 characters of SHA256 hash of response body.*");
  lines.push("");

  return lines.join("\n");
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength - 3) + "...";
}
