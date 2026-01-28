/**
 * POST /api/artifacts/process
 *
 * Process queued document artifacts.
 * This endpoint can be called by:
 *   - Internal server-to-server (x-buddy-internal header)
 *   - Vercel cron (WORKER_SECRET via header/query/bearer)
 *   - Super admins (via UI)
 *
 * Query params:
 * - max: Maximum number of artifacts to process (default: 10, max: 50)
 */

import { NextRequest, NextResponse } from "next/server";
import { processBatch } from "@/lib/artifacts/processArtifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for processing

/** Check if the request is authorized via internal header or worker secret. */
function isAuthorized(req: NextRequest): boolean {
  // Internal server-to-server call (same-origin, injected by upload route)
  if (req.headers.get("x-buddy-internal") === "1") return true;

  // Worker secret (cron / external worker)
  const secret = process.env.WORKER_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${secret}`) return true;
    if (req.headers.get("x-worker-secret") === secret) return true;
    const url = new URL(req.url);
    if (url.searchParams.get("token") === secret) return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

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
      { status: 500 },
    );
  }
}

// GET for dev testing only
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "GET not allowed in production" },
      { status: 405 },
    );
  }
  return POST(req);
}
