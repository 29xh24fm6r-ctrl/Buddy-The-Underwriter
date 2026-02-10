import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processNextOcrJob } from "@/lib/jobs/processors/ocrProcessor";
import { processNextClassifyJob } from "@/lib/jobs/processors/classifyProcessor";
import { processNextExtractJob } from "@/lib/jobs/processors/extractProcessor";
import { runSpreadsWorkerTick } from "@/lib/jobs/workers/spreadsWorker";
import { withBuddyGuard, sendHeartbeat } from "@/lib/aegis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/worker/tick
 *
 * Worker endpoint - processes next available job from queue
 * Call this from scheduler (cron, polling, etc.)
 *
 * Query params:
 * - type: OCR | CLASSIFY | EXTRACT | SPREADS | ALL (default ALL)
 * - batch_size: number of jobs to process (default 1, max 10)
 *
 * Returns: { ok: true, processed: number, results: [] }
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "ALL";

  // Auth: allow either WORKER_SECRET (cron/external scheduler) OR signed-in super admin.
  if (!hasValidWorkerSecret(req)) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const batchParam = url.searchParams.get("batch_size");
  const defaultBatch = type === "SPREADS" ? 3 : 1;
  const batchSize = Math.min(10, Math.max(1, Number(batchParam ?? String(defaultBatch))));

  const leaseOwner = `worker-${Date.now()}`;
  const results = [];

  // Aegis: wrap each processor with observability (side-effects only, never alters behavior)
  const guardedOcr = withBuddyGuard(processNextOcrJob, {
    source: "ocr_processor",
    jobTable: "document_jobs",
    getContext: (lo: string) => ({ correlationId: lo }),
  });
  const guardedClassify = withBuddyGuard(processNextClassifyJob, {
    source: "classify_processor",
    jobTable: "document_jobs",
    getContext: (lo: string) => ({ correlationId: lo }),
  });
  const guardedExtract = withBuddyGuard(processNextExtractJob, {
    source: "extract_processor",
    jobTable: "document_jobs",
    getContext: (lo: string) => ({ correlationId: lo }),
  });
  const guardedSpreads = withBuddyGuard(runSpreadsWorkerTick, {
    source: "spreads_processor",
    jobTable: "deal_spread_jobs",
    getContext: (opts: any) => ({ correlationId: opts?.leaseOwner }),
  });

  // Aegis: heartbeat at tick start
  sendHeartbeat({ workerId: leaseOwner, workerType: type.toLowerCase() }).catch(() => {});

  try {
    if (type === "SPREADS") {
      const r = await guardedSpreads({ leaseOwner, maxJobs: batchSize });
      return NextResponse.json(r);
    }

    for (let i = 0; i < batchSize; i++) {
      if (type === "OCR" || type === "ALL") {
        const ocrResult = await guardedOcr(leaseOwner);
        if (ocrResult.ok) {
          results.push({ type: "OCR", ...ocrResult });
          continue;
        }
      }

      if (type === "CLASSIFY" || type === "ALL") {
        const classifyResult = await guardedClassify(leaseOwner);
        if (classifyResult.ok) {
          results.push({ type: "CLASSIFY", ...classifyResult });
          continue;
        }
      }

      if (type === "EXTRACT" || type === "ALL") {
        const extractResult = await guardedExtract(leaseOwner);
        if (extractResult.ok) {
          results.push({ type: "EXTRACT", ...extractResult });
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
  // Stats are admin-only. (Keep simple: no WORKER_SECRET access here.)
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
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
