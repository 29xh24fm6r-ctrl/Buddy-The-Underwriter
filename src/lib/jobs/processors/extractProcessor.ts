import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractByDocType } from "@/lib/extract/router/extractByDocType";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

/**
 * Extract Job Processor
 *
 * Leases jobs from document_jobs queue (job_type = 'EXTRACT')
 * Routes to appropriate extraction engine via Smart Router
 * Stores results in document_extracts table
 * Logs provider_metrics to deal_pipeline_ledger for cost tracking
 */

export async function processExtractJob(jobId: string, leaseOwner: string) {
  const supabase = supabaseAdmin();
  const leaseDuration = 10 * 60 * 1000; // 10 minutes (extraction can be slow)
  const leaseUntil = new Date(Date.now() + leaseDuration).toISOString();

  try {
    // Lease the job
    const { data: job, error: e1 } = await (supabase as any)
      .from("document_jobs")
      .update({
        status: "RUNNING",
        leased_until: leaseUntil,
        lease_owner: leaseOwner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "QUEUED")
      .select()
      .single();

    if (e1 || !job) {
      return { ok: false, error: "Failed to lease job" };
    }

    // Get document info
    const { data: doc, error: docErr } = await (supabase as any)
      .from("deal_documents")
      .select("id, deal_id, bank_id, document_type, original_filename")
      .eq("id", job.attachment_id)
      .single();

    if (docErr || !doc) {
      throw new Error("Document not found");
    }

    // Run extraction via Smart Router
    const result = await extractByDocType(job.attachment_id);

    // Store extraction result
    await (supabase as any).from("document_extracts").upsert(
      {
        deal_id: job.deal_id,
        attachment_id: job.attachment_id,
        provider: result.provider_metrics?.provider || "smart_router",
        status: "SUCCEEDED",
        fields_json: result.result.fields,
        tables_json: result.result.tables,
        evidence_json: result.result.evidence,
        provider_metrics: result.provider_metrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attachment_id" },
    );

    // Mark job succeeded
    await (supabase as any)
      .from("document_jobs")
      .update({
        status: "SUCCEEDED",
        updated_at: new Date().toISOString(),
        metadata: {
          provider: result.provider_metrics?.provider,
          model: result.provider_metrics?.model,
          pages: result.provider_metrics?.pages,
          estimated_cost_usd: result.provider_metrics?.estimated_cost_usd,
        },
      })
      .eq("id", jobId);

    // Log completion with provider metrics
    await logLedgerEvent({
      dealId: job.deal_id,
      bankId: doc.bank_id,
      eventKey: "extract.job.completed",
      uiState: "done",
      uiMessage: `Extraction completed via ${result.provider_metrics?.provider || "smart_router"}`,
      meta: {
        job_id: jobId,
        doc_id: job.attachment_id,
        doc_type: doc.document_type,
      },
      provider_metrics: result.provider_metrics,
    });

    return { ok: true, jobId, provider_metrics: result.provider_metrics };
  } catch (error: any) {
    // Mark job failed
    const { data: failedJob } = await (supabase as any)
      .from("document_jobs")
      .select("attempt, max_attempts, deal_id, attachment_id")
      .eq("id", jobId)
      .single();

    const attempt = (failedJob?.attempt ?? 0) + 1;
    const maxAttempts = failedJob?.max_attempts ?? 3;

    // Try to get bank_id for logging
    let bankId: string | null = null;
    if (failedJob?.attachment_id) {
      const { data: doc } = await (supabase as any)
        .from("deal_documents")
        .select("bank_id")
        .eq("id", failedJob.attachment_id)
        .single();
      bankId = doc?.bank_id ?? null;
    }

    if (attempt >= maxAttempts) {
      // Final failure
      await (supabase as any)
        .from("document_jobs")
        .update({
          status: "FAILED",
          attempt,
          error: error?.message ?? String(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      // Log failure
      if (failedJob?.deal_id && bankId) {
        await logLedgerEvent({
          dealId: failedJob.deal_id,
          bankId,
          eventKey: "extract.job.failed",
          uiState: "error",
          uiMessage: `Extraction failed after ${maxAttempts} attempts`,
          meta: {
            job_id: jobId,
            error: error?.message ?? String(error),
          },
        });
      }
    } else {
      // Retry with exponential backoff
      const backoffMs = Math.min(60000 * Math.pow(2, attempt), 3600000); // Max 1 hour
      const nextRunAt = new Date(Date.now() + backoffMs).toISOString();

      await (supabase as any)
        .from("document_jobs")
        .update({
          status: "QUEUED",
          attempt,
          next_run_at: nextRunAt,
          error: error?.message ?? String(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return { ok: false, error: error?.message ?? String(error) };
  }
}

/**
 * Lease and process next available EXTRACT job
 * Call this from scheduler/worker
 */
export async function processNextExtractJob(leaseOwner: string = "worker-1") {
  const supabase = supabaseAdmin();

  // Find next job
  const { data: jobs } = await (supabase as any)
    .from("document_jobs")
    .select("id")
    .eq("job_type", "EXTRACT")
    .eq("status", "QUEUED")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return { ok: false, error: "No jobs available" };
  }

  return await processExtractJob(jobs[0].id, leaseOwner);
}

/**
 * Enqueue an EXTRACT job for a document.
 * Idempotent via UNIQUE(attachment_id, job_type) constraint.
 */
export async function enqueueExtractJob(dealId: string, docId: string) {
  const supabase = supabaseAdmin();

  const { error } = await (supabase as any).from("document_jobs").upsert(
    {
      deal_id: dealId,
      attachment_id: docId,
      job_type: "EXTRACT",
      status: "QUEUED",
      next_run_at: new Date().toISOString(),
    },
    { onConflict: "attachment_id,job_type" },
  );

  if (error) {
    console.error("[enqueueExtractJob] Failed to enqueue", { dealId, docId, error });
    throw error;
  }

  return { ok: true, dealId, docId };
}
