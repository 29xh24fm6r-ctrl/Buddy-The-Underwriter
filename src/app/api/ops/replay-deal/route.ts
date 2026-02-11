import "server-only";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ops/replay-deal
 *
 * Re-enqueues all FAILED jobs for a deal across both job tables.
 * Optionally uses backfillDealArtifacts() for full artifact replay.
 *
 * Body: { deal_id: string }
 * Auth: requireSuperAdmin()
 */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const { deal_id } = body ?? {};
  if (!deal_id || typeof deal_id !== "string") {
    return NextResponse.json(
      { ok: false, error: "deal_id is required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const results = {
    document_jobs_retried: 0,
    spread_jobs_retried: 0,
    artifacts_requeued: 0,
    garbage_facts_cleaned: 0,
    classification_error_artifacts_reset: 0,
    errors: [] as string[],
  };

  try {
    // 1. Re-enqueue failed document_jobs
    const { data: failedDocJobs } = await sb
      .from("document_jobs" as any)
      .select("id, job_type, error")
      .eq("deal_id", deal_id)
      .eq("status", "FAILED");

    for (const job of (failedDocJobs ?? []) as any[]) {
      const { error } = await sb
        .from("document_jobs" as any)
        .update({
          status: "QUEUED",
          next_run_at: now,
          leased_until: null,
          lease_owner: null,
          error: `[replay] previous: ${job.error ?? "none"}`,
          updated_at: now,
        } as any)
        .eq("id", job.id);

      if (error) {
        results.errors.push(`doc_job ${job.id}: ${error.message}`);
      } else {
        results.document_jobs_retried++;
        writeSystemEvent({
          event_type: "retry",
          severity: "info",
          source_system: "api",
          source_job_id: job.id,
          source_job_table: "document_jobs",
          deal_id,
          resolution_status: "retrying",
          payload: { triggered_by: "deal_replay", job_type: job.job_type },
        }).catch(() => {});
      }
    }

    // 2. Re-enqueue failed spread jobs
    const { data: failedSpreadJobs } = await sb
      .from("deal_spread_jobs" as any)
      .select("id, error")
      .eq("deal_id", deal_id)
      .eq("status", "FAILED");

    for (const job of (failedSpreadJobs ?? []) as any[]) {
      const { error } = await sb
        .from("deal_spread_jobs" as any)
        .update({
          status: "QUEUED",
          next_run_at: now,
          leased_until: null,
          lease_owner: null,
          error: `[replay] previous: ${job.error ?? "none"}`,
          updated_at: now,
        } as any)
        .eq("id", job.id);

      if (error) {
        results.errors.push(`spread_job ${job.id}: ${error.message}`);
      } else {
        results.spread_jobs_retried++;
        writeSystemEvent({
          event_type: "retry",
          severity: "info",
          source_system: "api",
          source_job_id: job.id,
          source_job_table: "deal_spread_jobs",
          deal_id,
          resolution_status: "retrying",
          payload: { triggered_by: "deal_replay" },
        }).catch(() => {});
      }
    }

    // 2.5. Clean garbage facts from classification-error artifacts
    //       and reset those artifacts to 'queued' for reprocessing
    try {
      const { data: errorArtifacts } = await sb
        .from("document_artifacts" as any)
        .select("id, source_id, error_message")
        .eq("deal_id", deal_id)
        .eq("status", "failed")
        .like("error_message", "classification_error:%");

      if (errorArtifacts && errorArtifacts.length > 0) {
        const badSourceIds = (errorArtifacts as any[]).map((a: any) => a.source_id);

        // Delete ALL facts from these source documents (garbage data)
        const { count: deletedFacts } = await sb
          .from("deal_financial_facts" as any)
          .delete({ count: "exact" })
          .eq("deal_id", deal_id)
          .in("source_document_id", badSourceIds);

        results.garbage_facts_cleaned = deletedFacts ?? 0;

        // Reset artifacts back to 'queued' for clean reprocessing
        for (const art of errorArtifacts as any[]) {
          await sb
            .from("document_artifacts" as any)
            .update({
              status: "queued",
              error_message: `[replay] previous: ${art.error_message ?? "none"}`,
              extraction_json: null,
            } as any)
            .eq("id", art.id);
        }
        results.classification_error_artifacts_reset = (errorArtifacts as any[]).length;

        writeSystemEvent({
          event_type: "recovery",
          severity: "info",
          source_system: "api",
          deal_id,
          resolution_status: "retrying",
          payload: {
            triggered_by: "deal_replay_garbage_cleanup",
            bad_source_ids: badSourceIds,
            facts_deleted: results.garbage_facts_cleaned,
            artifacts_reset: results.classification_error_artifacts_reset,
          },
        }).catch(() => {});
      }
    } catch (cleanErr: any) {
      results.errors.push(`garbage_cleanup: ${cleanErr.message}`);
    }

    // 3. Re-queue failed artifacts
    try {
      const { data: deal } = await sb
        .from("deals" as any)
        .select("bank_id")
        .eq("id", deal_id)
        .maybeSingle();

      if (deal) {
        const { backfillDealArtifacts } = await import(
          "@/lib/artifacts/queueArtifact"
        );
        const artResult = await backfillDealArtifacts(
          deal_id,
          (deal as any).bank_id,
        );
        results.artifacts_requeued = artResult.queued;
      }
    } catch (artErr: any) {
      results.errors.push(`artifacts: ${artErr.message}`);
    }

    // Write replay system event
    await writeSystemEvent({
      event_type: "recovery",
      severity: "info",
      source_system: "api",
      deal_id,
      resolution_status: "retrying",
      payload: {
        triggered_by: "deal_replay",
        ...results,
      },
    });

    return NextResponse.json({ ok: true, deal_id, ...results });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
