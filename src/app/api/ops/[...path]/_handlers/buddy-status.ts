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
 * GET /api/ops/buddy-status
 *
 * Returns system health: active workers, queue depth, recent errors,
 * open system events by severity, oldest stuck job per source.
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

  const sb = supabaseAdmin();

  try {
    // Workers
    const { data: workers } = await sb
      .from("buddy_workers" as any)
      .select("*")
      .order("last_heartbeat_at", { ascending: false });

    // Queue depth via unified view
    const { data: queueRaw } = await sb
      .from("v_unified_jobs" as any)
      .select("job_kind, status")
      .in("status", ["QUEUED", "RUNNING"]);

    const queueDepth: Record<string, { queued: number; running: number }> = {};
    for (const row of (queueRaw ?? []) as any[]) {
      const k = row.job_kind;
      if (!queueDepth[k]) queueDepth[k] = { queued: 0, running: 0 };
      if (row.status === "QUEUED") queueDepth[k].queued++;
      else if (row.status === "RUNNING") queueDepth[k].running++;
    }

    // Recent errors (last 24h) grouped by error_signature
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: recentErrors } = await sb
      .from("buddy_system_events" as any)
      .select(
        "error_signature, error_class, error_code, error_message, source_system, severity, count:id",
      )
      .in("event_type", ["error", "warning"])
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(100);

    // Group errors by signature
    const errorGroups: Record<
      string,
      {
        signature: string;
        count: number;
        error_class: string;
        error_code: string;
        error_message: string;
        source_system: string;
        severity: string;
      }
    > = {};
    for (const row of (recentErrors ?? []) as any[]) {
      const sig = row.error_signature ?? "unknown";
      if (!errorGroups[sig]) {
        errorGroups[sig] = {
          signature: sig,
          count: 0,
          error_class: row.error_class,
          error_code: row.error_code,
          error_message: row.error_message,
          source_system: row.source_system,
          severity: row.severity,
        };
      }
      errorGroups[sig].count++;
    }

    // Open events by severity
    const { data: openEvents } = await sb
      .from("buddy_system_events" as any)
      .select("severity")
      .eq("resolution_status", "open")
      .in("event_type", ["error", "warning", "stuck_job", "lease_expired"]);

    const openBySeverity: Record<string, number> = {};
    for (const row of (openEvents ?? []) as any[]) {
      openBySeverity[row.severity] = (openBySeverity[row.severity] ?? 0) + 1;
    }

    // Last observer tick
    const { data: lastTick } = await sb
      .from("buddy_system_events" as any)
      .select("created_at, payload")
      .eq("event_type", "heartbeat")
      .eq("source_system", "observer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      workers: workers ?? [],
      queue_depth: queueDepth,
      recent_error_groups: Object.values(errorGroups).sort(
        (a, b) => b.count - a.count,
      ),
      open_events_by_severity: openBySeverity,
      observer_last_tick: lastTick
        ? {
            at: (lastTick as any).created_at,
            payload: (lastTick as any).payload,
          }
        : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
