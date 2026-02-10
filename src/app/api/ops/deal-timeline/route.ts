import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidWorkerSecret(req: NextRequest): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  if (req.headers.get("x-worker-secret") === secret) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("token") === secret) return true;
  return false;
}

/**
 * GET /api/ops/deal-timeline?deal_id=UUID
 *
 * Returns an ordered timeline of buddy_system_events for a specific deal.
 * One-shot answer to "Why is this deal stuck?"
 *
 * Query params:
 * - deal_id (required): UUID of the deal
 * - limit: Max events to return (default: 100, max: 500)
 *
 * Auth: requireSuperAdmin() OR WORKER_SECRET
 */
export async function GET(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  const url = new URL(req.url);
  const dealId = url.searchParams.get("deal_id");

  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "deal_id query parameter is required" },
      { status: 400 },
    );
  }

  // Basic UUID validation
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(dealId)) {
    return NextResponse.json(
      { ok: false, error: "deal_id must be a valid UUID" },
      { status: 400 },
    );
  }

  let limit = parseInt(url.searchParams.get("limit") || "100", 10);
  limit = Math.min(500, Math.max(1, limit || 100));

  const sb = supabaseAdmin();

  try {
    // Fetch all system events for this deal, ordered chronologically
    const { data: events, error } = await sb
      .from("buddy_system_events" as any)
      .select(
        "id, event_type, severity, error_class, error_code, error_signature, error_message, " +
          "source_system, source_job_id, source_job_table, " +
          "resolution_status, resolution_note, resolved_at, resolved_by, " +
          "retry_attempt, max_retries, next_retry_at, " +
          "payload, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    // Summary statistics
    const timeline = (events ?? []) as any[];
    const summary = {
      total_events: timeline.length,
      by_severity: {} as Record<string, number>,
      by_event_type: {} as Record<string, number>,
      by_resolution: {} as Record<string, number>,
      open_issues: 0,
      latest_event_at: timeline.length > 0 ? timeline[timeline.length - 1].created_at : null,
    };

    for (const evt of timeline) {
      summary.by_severity[evt.severity] =
        (summary.by_severity[evt.severity] ?? 0) + 1;
      summary.by_event_type[evt.event_type] =
        (summary.by_event_type[evt.event_type] ?? 0) + 1;
      summary.by_resolution[evt.resolution_status] =
        (summary.by_resolution[evt.resolution_status] ?? 0) + 1;
      if (
        evt.resolution_status === "open" ||
        evt.resolution_status === "retrying"
      ) {
        summary.open_issues++;
      }
    }

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      summary,
      events: timeline,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
