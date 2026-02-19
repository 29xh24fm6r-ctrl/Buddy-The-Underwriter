/**
 * GET /api/admin/intake/reliability
 *
 * Phase C — Intake Governance Dashboard data endpoint.
 * Returns worker health, queue latency, and OCR failure metrics from
 * the three governance views created in the Phase C migration.
 *
 * Auth: requireSuperAdmin()
 * Fail-safe: empty arrays on view error (never 500 for view failures).
 * Pattern follows /api/admin/intake/segmentation/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type WorkerHealthRow = {
  worker_id: string | null;
  worker_type: string | null;
  status: string | null;
  last_heartbeat_at: string | null;
  seconds_since_heartbeat: number | null;
  consecutive_failures: number | null;
  health_color: string | null;
};

type QueueLatencyRow = {
  job_type: string | null;
  queued_count: number | null;
  max_queue_age_seconds: number | null;
  health_color: string | null;
};

type OcrFailuresRow = {
  failed_count_24h: number;
  empty_ocr_count_24h: number;
  total_24h: number;
  health_color: string | null;
};

type ReliabilityResponse =
  | {
      ok: true;
      workerHealth: WorkerHealthRow[];
      queueLatency: QueueLatencyRow[];
      ocrFailures: OcrFailuresRow;
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/reliability
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<ReliabilityResponse>> {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const sb = supabaseAdmin();

    // Parallel queries — all fail-safe
    const [workerRes, queueRes, ocrRes] = await Promise.all([
      (sb as any).from("intake_worker_health_v1").select("*"),
      (sb as any).from("intake_queue_latency_v1").select("*"),
      (sb as any).from("intake_ocr_failures_v1").select("*").maybeSingle(),
    ]);

    if (workerRes.error) {
      console.warn("[admin/reliability] worker health query error (non-fatal):", workerRes.error);
    }
    if (queueRes.error) {
      console.warn("[admin/reliability] queue latency query error (non-fatal):", queueRes.error);
    }
    if (ocrRes.error) {
      console.warn("[admin/reliability] OCR failures query error (non-fatal):", ocrRes.error);
    }

    const workerHealth: WorkerHealthRow[] = (workerRes.data ?? []).map((r: any) => ({
      worker_id: r.worker_id ?? null,
      worker_type: r.worker_type ?? null,
      status: r.status ?? null,
      last_heartbeat_at: r.last_heartbeat_at ?? null,
      seconds_since_heartbeat: r.seconds_since_heartbeat != null ? Number(r.seconds_since_heartbeat) : null,
      consecutive_failures: r.consecutive_failures != null ? Number(r.consecutive_failures) : null,
      health_color: r.health_color ?? null,
    }));

    const queueLatency: QueueLatencyRow[] = (queueRes.data ?? []).map((r: any) => ({
      job_type: r.job_type ?? null,
      queued_count: r.queued_count != null ? Number(r.queued_count) : null,
      max_queue_age_seconds: r.max_queue_age_seconds != null ? Number(r.max_queue_age_seconds) : null,
      health_color: r.health_color ?? null,
    }));

    const rawOcr = ocrRes.data;
    const ocrFailures: OcrFailuresRow = {
      failed_count_24h: Number(rawOcr?.failed_count_24h ?? 0),
      empty_ocr_count_24h: Number(rawOcr?.empty_ocr_count_24h ?? 0),
      total_24h: Number(rawOcr?.total_24h ?? 0),
      health_color: rawOcr?.health_color ?? null,
    };

    return NextResponse.json({ ok: true, workerHealth, queueLatency, ocrFailures });
  } catch (e: any) {
    console.error("[admin/reliability] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
