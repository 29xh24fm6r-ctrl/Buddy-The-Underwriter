import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis";

/**
 * Lease-expiry reclaim for the legacy `document_jobs` queue (OCR / CLASSIFY /
 * EXTRACT).
 *
 * Each processor (ocrProcessor, classifyProcessor, extractProcessor) sets
 * `leased_until` when it claims a row (status -> 'RUNNING'), but nothing
 * previously reclaimed a row whose lease expired while still 'RUNNING' — e.g.
 * because the invocation crashed, hit maxDuration, or the platform recycled
 * the function before the processor's own try/catch could mark the job
 * SUCCEEDED/FAILED/retry-QUEUED. Left alone, such a row is invisible to
 * processNext{Ocr,Classify,Extract}Job (which only selects status='QUEUED')
 * and permanently blocks that (attachment_id, job_type) pair, since the
 * UNIQUE(attachment_id, job_type) constraint prevents re-enqueueing.
 *
 * Mirrors src/lib/spreads/janitor/cleanupStuckJobs.ts's pattern for the
 * separate `deal_spread_jobs` table, but reuses document_jobs' own
 * attempt/max_attempts columns (the same ones each processor's catch-block
 * retry logic already uses) instead of a fixed threshold: jobs with attempts
 * remaining are requeued immediately, jobs that have exhausted max_attempts
 * are marked FAILED. The per-row `leased_until` (already sized differently
 * per job type: 5 min for OCR, 3 min for CLASSIFY, 10 min for EXTRACT) is the
 * staleness threshold — no separate fixed-minutes config is needed.
 *
 * Called from the document-job-draining path of /api/jobs/worker/tick (OCR,
 * CLASSIFY, EXTRACT, ALL) — run BEFORE the claim loop so a just-reclaimed
 * job can be picked up again in the same tick.
 */
export async function cleanupStuckDocumentJobs(): Promise<{
  ok: boolean;
  cleaned: number;
  requeued: number;
  failed: number;
  error?: string;
}> {
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  try {
    const { data: stuck, error } = await (sb as any)
      .from("document_jobs")
      .select("id, deal_id, attachment_id, job_type, attempt, max_attempts")
      .eq("status", "RUNNING")
      .lt("leased_until", nowIso);

    if (error) return { ok: false, cleaned: 0, requeued: 0, failed: 0, error: error.message };
    if (!stuck || stuck.length === 0) return { ok: true, cleaned: 0, requeued: 0, failed: 0 };

    let requeued = 0;
    let failed = 0;

    for (const job of stuck) {
      const attempt = (job.attempt ?? 0) + 1;
      const maxAttempts = job.max_attempts ?? 3;
      const isFinal = attempt >= maxAttempts;

      const { error: updErr } = await (sb as any)
        .from("document_jobs")
        .update(
          isFinal
            ? {
                status: "FAILED",
                attempt,
                error: `Stuck in RUNNING past leased_until; auto-failed after ${attempt} attempt(s)`,
                leased_until: null,
                lease_owner: null,
                updated_at: nowIso,
              }
            : {
                status: "QUEUED",
                attempt,
                next_run_at: nowIso,
                error: "Stuck in RUNNING past leased_until; auto-requeued by document_jobs janitor",
                leased_until: null,
                lease_owner: null,
                updated_at: nowIso,
              },
        )
        .eq("id", job.id)
        .eq("status", "RUNNING"); // guard against racing a legitimate completion

      if (!updErr) {
        if (isFinal) failed += 1;
        else requeued += 1;
      }
    }

    const cleaned = requeued + failed;

    if (cleaned > 0) {
      const sampleIds = stuck.slice(0, 10).map((j: any) => j.id);
      console.warn("[document-jobs-janitor] reclaimed stuck RUNNING document_jobs", {
        cleaned,
        requeued,
        failed,
        sample_ids: sampleIds,
      });

      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "document_jobs_janitor",
        error_class: "transient",
        error_code: "DOCUMENT_JOB_STUCK_AUTO_RECLAIMED",
        error_message: `Auto-reclaimed ${cleaned} stuck document_jobs row(s) (${requeued} requeued, ${failed} failed)`,
        payload: {
          cleaned_count: cleaned,
          requeued_count: requeued,
          failed_count: failed,
          sample_ids: sampleIds,
        },
      }).catch(() => {});
    }

    return { ok: true, cleaned, requeued, failed };
  } catch (e: any) {
    return { ok: false, cleaned: 0, requeued: 0, failed: 0, error: e?.message ?? "unknown" };
  }
}
