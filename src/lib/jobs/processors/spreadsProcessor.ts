import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { renderSpread } from "@/lib/financialSpreads/renderSpread";
import type { SpreadType } from "@/lib/financialSpreads/types";

const LEASE_MS = 3 * 60 * 1000;

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function processSpreadJob(jobId: string, leaseOwner: string) {
  const sb = supabaseAdmin();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();

  // Lease
  const { data: job, error: leaseErr } = await (sb as any)
    .from("deal_spread_jobs")
    .update({
      status: "RUNNING",
      started_at: new Date().toISOString(),
      leased_until: leaseUntil,
      lease_owner: leaseOwner,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "QUEUED")
    .select()
    .maybeSingle();

  if (leaseErr || !job) {
    return { ok: false as const, error: "Failed to lease spread job" };
  }

  try {
    const dealId = String(job.deal_id);
    const bankId = String(job.bank_id);
    const sourceDocumentId = job.source_document_id ? String(job.source_document_id) : null;

    const requested = uniq((job.requested_spread_types ?? []) as string[])
      .map((s) => String(s))
      .filter(Boolean) as SpreadType[];

    const jobMeta = (job.meta && typeof job.meta === "object") ? job.meta : {};
    const ownerType = typeof jobMeta.owner_type === "string" ? jobMeta.owner_type : undefined;
    const ownerEntityId = typeof jobMeta.owner_entity_id === "string" ? jobMeta.owner_entity_id : null;

    if (sourceDocumentId) {
      await extractFactsFromDocument({ dealId, bankId, documentId: sourceDocumentId });
    }

    for (const spreadType of requested) {
      await renderSpread({ dealId, bankId, spreadType, ownerType, ownerEntityId });
    }

    await (sb as any)
      .from("deal_spread_jobs")
      .update({
        status: "SUCCEEDED",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", jobId);

    return { ok: true as const, jobId };
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);

    const { data: cur } = await (sb as any)
      .from("deal_spread_jobs")
      .select("attempt, max_attempts")
      .eq("id", jobId)
      .maybeSingle();

    const attempt = Number(cur?.attempt ?? 0) + 1;
    const maxAttempts = Number(cur?.max_attempts ?? 3);

    if (attempt >= maxAttempts) {
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "FAILED",
          attempt,
          error: errMsg,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } else {
      const backoffMs = Math.min(30000 * Math.pow(2, attempt), 300000);
      const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "QUEUED",
          attempt,
          next_run_at: nextRunAt,
          error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return { ok: false as const, error: errMsg };
  }
}

export async function processNextSpreadJob(leaseOwner: string = "worker-1") {
  const sb = supabaseAdmin();

  const { data: jobs } = await (sb as any)
    .from("deal_spread_jobs")
    .select("id")
    .eq("status", "QUEUED")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return { ok: false as const, error: "No jobs available" };
  }

  return await processSpreadJob(String(jobs[0].id), leaseOwner);
}
