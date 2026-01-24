/**
 * POST /api/artifacts/process
 *
 * Process queued document artifacts.
 * This endpoint can be called by a cron job or manually triggered.
 *
 * Query params:
 * - max: Maximum number of artifacts to process (default: 10, max: 50)
 */

import { NextRequest, NextResponse } from "next/server";
import { processBatch } from "@/lib/artifacts/processArtifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for processing

export async function POST(req: NextRequest) {
  try {
    // Parse max from query or body
    const url = new URL(req.url);
    let max = parseInt(url.searchParams.get("max") || "10", 10);

    // Try to get from body too
    try {
      const body = await req.json().catch(() => ({}));
      if (body.max) {
        max = parseInt(body.max, 10);
      }
    } catch {
      // Ignore body parse errors
    }

    // Clamp max to reasonable limits
    max = Math.min(50, Math.max(1, max || 10));

    console.log("[artifacts/process] starting batch", { max });

    const startTime = Date.now();
    const results = await processBatch(max);
    const duration = Date.now() - startTime;

    const summary = {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      duration_ms: duration,
    };

    console.log("[artifacts/process] batch complete", summary);

    return NextResponse.json({
      ok: true,
      ...summary,
      results: results.map((r) => ({
        artifact_id: r.artifactId,
        ok: r.ok,
        doc_type: r.classification?.docType,
        confidence: r.classification?.confidence,
        matched_keys: r.matchedKeys,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[artifacts/process] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// Also allow GET for easy testing
export async function GET(req: NextRequest) {
  return POST(req);
}
