import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { processNextOcrJob } from "@/lib/jobs/processors/ocrProcessor";
import { processNextClassifyJob } from "@/lib/jobs/processors/classifyProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/worker/tick
 *
 * Worker endpoint - processes next available job from queue
 * Call this from scheduler (cron, polling, etc.)
 *
 * Query params:
 * - type: OCR | CLASSIFY | ALL (default ALL)
 * - batch_size: number of jobs to process (default 1, max 10)
 *
 * Returns: { ok: true, processed: number, results: [] }
 */
export async function POST(req: NextRequest) {
  requireSuperAdmin();

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "ALL";
  const batchSize = Math.min(
    10,
    Math.max(1, Number(url.searchParams.get("batch_size") ?? "1")),
  );

  const leaseOwner = `worker-${Date.now()}`;
  const results = [];

  try {
    for (let i = 0; i < batchSize; i++) {
      if (type === "OCR" || type === "ALL") {
        const ocrResult = await processNextOcrJob(leaseOwner);
        if (ocrResult.ok) {
          results.push({ type: "OCR", ...ocrResult });
          continue;
        }
      }

      if (type === "CLASSIFY" || type === "ALL") {
        const classifyResult = await processNextClassifyJob(leaseOwner);
        if (classifyResult.ok) {
          results.push({ type: "CLASSIFY", ...classifyResult });
          continue;
        }
      }

      // No more jobs available
      break;
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/jobs/worker/stats
 *
 * Returns job queue statistics
 */
export async function GET() {
  requireSuperAdmin();
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const supabase = supabaseAdmin();

  try {
    // Count jobs by status
    const { data: jobs, error } = await (supabase as any)
      .from("document_jobs")
      .select("job_type, status, count");

    if (error) throw error;

    // Aggregate stats
    const stats = {
      total: 0,
      by_type: {} as Record<string, any>,
      by_status: {} as Record<string, number>,
    };

    for (const job of jobs ?? []) {
      const type = job.job_type;
      const status = job.status;

      if (!stats.by_type[type]) {
        stats.by_type[type] = {
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
        };
      }

      stats.by_type[type][status.toLowerCase()] =
        (stats.by_type[type][status.toLowerCase()] ?? 0) + 1;
      stats.by_status[status] = (stats.by_status[status] ?? 0) + 1;
      stats.total++;
    }

    return NextResponse.json({ ok: true, stats });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}
