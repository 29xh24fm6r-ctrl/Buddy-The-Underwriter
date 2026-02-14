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
export const maxDuration = 300; // 5 min (3 min lease + buffer)

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
  const defaultBatch = type === "SPREADS" ? 1 : 1;
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

    // Process spread jobs when running ALL (after document jobs)
    if (type === "ALL") {
      const spreadResult = await guardedSpreads({ leaseOwner, maxJobs: Math.max(1, batchSize) });
      if (spreadResult.ok && spreadResult.processed > 0) {
        results.push({ type: "SPREADS", ...spreadResult });
      }
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
 * GET /api/jobs/worker/tick
 *
 * Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET>.
 * When cron/worker-authenticated, delegate to POST for job processing.
 * Otherwise, return job queue statistics (admin-only).
 */
export async function GET(req: NextRequest) {
  // Vercel Cron sends GET — delegate to POST for actual job processing
  if (hasValidWorkerSecret(req)) {
    return POST(req);
  }

  // Stats are admin-only
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const supabase = supabaseAdmin();

  try {
    const STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
    const JOB_TYPES = ["OCR", "CLASSIFY", "EXTRACT"] as const;

    // Run all count queries in parallel (head: true = no row data, just count)
    const countQ = (filter?: { col: string; val: string }) => {
      let q = (supabase as any)
        .from("document_jobs")
        .select("id", { count: "exact", head: true });
      if (filter) q = q.eq(filter.col, filter.val);
      return q;
    };

    const [totalRes, ...groupRes] = await Promise.all([
      countQ(),
      ...STATUSES.map((s) => countQ({ col: "status", val: s })),
      ...JOB_TYPES.map((t) => countQ({ col: "job_type", val: t })),
    ]);

    if (totalRes.error) throw totalRes.error;

    const by_status: Record<string, number> = {};
    STATUSES.forEach((s, i) => {
      const c = groupRes[i]?.count ?? 0;
      if (c > 0) by_status[s] = c;
    });

    const by_type: Record<string, number> = {};
    JOB_TYPES.forEach((t, i) => {
      const c = groupRes[STATUSES.length + i]?.count ?? 0;
      if (c > 0) by_type[t] = c;
    });

    const stats = {
      total: totalRes.count ?? 0,
      by_type,
      by_status,
    };

    return NextResponse.json({ ok: true, stats });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}
