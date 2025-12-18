import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runOcrJob } from "@/lib/ocr/runOcrJob";
import { reconcileConditionsFromOcrResult } from "@/lib/conditions/reconcileConditions";
import { createClient } from "@supabase/supabase-js";

/**
 * OCR Job Processor
 * 
 * Leases jobs from document_jobs queue
 * Processes OCR via Azure DI
 * Stores results in document_ocr_results
 * Enqueues CLASSIFY job on success
 */

export async function processOcrJob(jobId: string, leaseOwner: string) {
  const supabase = supabaseAdmin();
  const leaseDuration = 5 * 60 * 1000; // 5 minutes
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
      // Job already leased or doesn't exist
      return { ok: false, error: "Failed to lease job" };
    }

    // Fetch attachment details
    const { data: attachment, error: e2 } = await (supabase as any)
      .from("borrower_attachments")
      .select("id, stored_name, application_id")
      .eq("id", job.attachment_id)
      .single();

    if (e2 || !attachment) {
      throw new Error("Attachment not found");
    }

    // Run OCR (using existing runOcrJob function - it handles file download internally)
    const ocrResult = await runOcrJob({
      dealId: job.deal_id,
      jobId: jobId,
    });
    
    // runOcrJob returns result object directly
    const extractedText = ocrResult.text_preview ?? "";
    const rawData = ocrResult.raw;

    // Store OCR result
    await (supabase as any)
      .from("document_ocr_results")
      .upsert({
        deal_id: job.deal_id,
        attachment_id: job.attachment_id,
        provider: "azure_di",
        status: "SUCCEEDED",
        raw_json: rawData,
        extracted_text: extractedText,
        tables_json: [],
      });

    // MEGA STEP 10: Reconcile conditions (auto-satisfy matching conditions)
    try {
      const sb = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );
      
      await reconcileConditionsFromOcrResult({
        sb,
        dealId: job.deal_id,
        jobId: jobId,
        payload: {
          file_id: attachment.id,
          stored_name: attachment.stored_name,
          extracted_text: extractedText,
          ...rawData,
        },
        source: "ocr",
      });
    } catch (reconErr) {
      // Non-fatal - log but don't fail job
      console.error("Condition reconciliation failed (non-fatal):", reconErr);
    }

    // Mark job succeeded
    await (supabase as any)
      .from("document_jobs")
      .update({
        status: "SUCCEEDED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Enqueue CLASSIFY job
    await (supabase as any)
      .from("document_jobs")
      .upsert(
        {
          deal_id: job.deal_id,
          attachment_id: job.attachment_id,
          job_type: "CLASSIFY",
          status: "QUEUED",
          next_run_at: new Date().toISOString(),
        },
        { onConflict: "attachment_id,job_type" }
      );

    return { ok: true, jobId };
  } catch (error: any) {
    // Mark job failed
    const { data: failedJob } = await (supabase as any)
      .from("document_jobs")
      .select("attempt, max_attempts")
      .eq("id", jobId)
      .single();

    const attempt = (failedJob?.attempt ?? 0) + 1;
    const maxAttempts = failedJob?.max_attempts ?? 3;

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
 * Lease and process next available OCR job
 * Call this from scheduler/worker
 */
export async function processNextOcrJob(leaseOwner: string = "worker-1") {
  const supabase = supabaseAdmin();

  // Find next job
  const { data: jobs } = await (supabase as any)
    .from("document_jobs")
    .select("id")
    .eq("job_type", "OCR")
    .eq("status", "QUEUED")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return { ok: false, error: "No jobs available" };
  }

  return await processOcrJob(jobs[0].id, leaseOwner);
}
