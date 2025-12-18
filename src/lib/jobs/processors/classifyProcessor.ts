import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyDocument } from "@/lib/intelligence/classifyDocument";
import { reconcileConditionsFromOcrResult } from "@/lib/conditions/reconcileConditions";
import { createClient } from "@supabase/supabase-js";

/**
 * Classification Job Processor
 * 
 * Reads OCR results
 * Runs deterministic classifier
 * Stores results in document_classifications
 * Triggers conditions recompute
 */

export async function processClassifyJob(jobId: string, leaseOwner: string) {
  const supabase = supabaseAdmin();
  const leaseDuration = 3 * 60 * 1000; // 3 minutes
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

    // Fetch OCR result
    const { data: ocrResult, error: e2 } = await (supabase as any)
      .from("document_ocr_results")
      .select("extracted_text, raw_json")
      .eq("attachment_id", job.attachment_id)
      .single();

    if (e2 || !ocrResult) {
      throw new Error("OCR result not found");
    }

    // Run classifier (using existing classifyDocument function)
    const classifyResult = await classifyDocument(ocrResult.extracted_text ?? "");

    // classifyDocument returns ClassificationResult (no .ok field)
    if (!classifyResult.doc_type) {
      throw new Error("Classification failed - no doc_type returned");
    }

    // Store classification result
    await (supabase as any)
      .from("document_classifications")
      .upsert({
        deal_id: job.deal_id,
        attachment_id: job.attachment_id,
        doc_type: classifyResult.doc_type,
        confidence: classifyResult.confidence ?? null,
        reasons: classifyResult.reasons ?? [],
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
          classification: {
            doc_type: classifyResult.doc_type,
            confidence: classifyResult.confidence,
            reasons: classifyResult.reasons,
          },
          file_id: job.attachment_id,
        },
        source: "classify",
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

    return {
      ok: true,
      jobId,
      docType: classifyResult.doc_type,
    };
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
      // Retry
      const backoffMs = Math.min(30000 * Math.pow(2, attempt), 300000); // Max 5 minutes
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
 * Lease and process next available CLASSIFY job
 */
export async function processNextClassifyJob(leaseOwner: string = "worker-1") {
  const supabase = supabaseAdmin();

  const { data: jobs } = await (supabase as any)
    .from("document_jobs")
    .select("id")
    .eq("job_type", "CLASSIFY")
    .eq("status", "QUEUED")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return { ok: false, error: "No jobs available" };
  }

  return await processClassifyJob(jobs[0].id, leaseOwner);
}
