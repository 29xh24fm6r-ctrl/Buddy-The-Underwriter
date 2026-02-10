import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { renderSpread } from "@/lib/financialSpreads/renderSpread";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { writeSystemEvent } from "@/lib/aegis";

const LEASE_MS = 3 * 60 * 1000;

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

const SPREAD_EVENT_KEY: Record<string, string> = {
  T12: "spread.business.completed",
  BALANCE_SHEET: "spread.business.completed",
  RENT_ROLL: "spread.rentroll.completed",
  PERSONAL_INCOME: "spread.personal.completed",
  PERSONAL_FINANCIAL_STATEMENT: "spread.personal.completed",
  GLOBAL_CASH_FLOW: "spread.global.completed",
};

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

  const dealId = String(job.deal_id);
  const bankId = String(job.bank_id);

  try {
    const sourceDocumentId = job.source_document_id ? String(job.source_document_id) : null;

    const requested = uniq((job.requested_spread_types ?? []) as string[])
      .map((s) => String(s))
      .filter(Boolean) as SpreadType[];

    const jobMeta = (job.meta && typeof job.meta === "object") ? job.meta : {};
    const ownerType = typeof jobMeta.owner_type === "string" ? jobMeta.owner_type : undefined;
    const ownerEntityId = typeof jobMeta.owner_entity_id === "string" ? jobMeta.owner_entity_id : SENTINEL_UUID;

    await logLedgerEvent({
      dealId, bankId,
      eventKey: "spread.run.started",
      uiState: "working",
      uiMessage: `Spread generation started: ${requested.join(", ")}`,
      meta: { jobId, spreadTypes: requested, sourceDocumentId },
    });

    if (sourceDocumentId) {
      await extractFactsFromDocument({ dealId, bankId, documentId: sourceDocumentId });
      await logLedgerEvent({
        dealId, bankId,
        eventKey: "spread.inputs.collected",
        uiState: "working",
        uiMessage: "Financial facts extracted from source document",
        meta: { jobId, sourceDocumentId },
      });
    }

    for (const spreadType of requested) {
      await renderSpread({ dealId, bankId, spreadType, ownerType, ownerEntityId });

      // Empty-row invariant: warn if spread rendered with 0 data rows
      try {
        const { data: spread } = await (sb as any)
          .from("deal_spreads")
          .select("id, rendered_json")
          .eq("deal_id", dealId)
          .eq("bank_id", bankId)
          .eq("spread_type", spreadType)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (spread?.rendered_json) {
          const rows = spread.rendered_json?.rows ?? spread.rendered_json?.data;
          if (Array.isArray(rows) && rows.length === 0) {
            writeSystemEvent({
              deal_id: dealId,
              bank_id: bankId,
              event_type: "warning",
              severity: "warning",
              error_class: "permanent",
              error_message: `${spreadType} spread rendered with 0 data rows`,
              source_system: "spreads_processor",
              source_job_id: jobId,
              source_job_table: "deal_spread_jobs",
              payload: { spreadType, spreadId: spread.id },
            }).catch(() => {});
          }
        }
      } catch {
        // Invariant check is fire-and-forget
      }

      await logLedgerEvent({
        dealId, bankId,
        eventKey: SPREAD_EVENT_KEY[spreadType] ?? "spread.type.completed",
        uiState: "working",
        uiMessage: `${spreadType} spread rendered`,
        meta: { jobId, spreadType },
      });
    }

    // Materialize canonical facts from rendered spreads
    const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });
    await logLedgerEvent({
      dealId, bankId,
      eventKey: backfill.ok ? "facts.materialization.completed" : "facts.materialization.failed",
      uiState: backfill.ok ? "done" : "error",
      uiMessage: backfill.ok
        ? `${backfill.factsWritten} canonical facts materialized from spreads`
        : `Facts materialization failed: ${(backfill as any).error}`,
      meta: backfill.ok
        ? { jobId, factsWritten: backfill.factsWritten, notes: backfill.notes }
        : { jobId, error: (backfill as any).error },
    });

    await (sb as any)
      .from("deal_spread_jobs")
      .update({
        status: "SUCCEEDED",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", jobId);

    // Best-effort invariant check — log violations but never fail the job
    try {
      const { data: violations } = await (sb as any).rpc(
        "assert_spread_invariant",
        { p_deal_id: dealId },
      );
      if (violations && violations.length > 0) {
        await logLedgerEvent({
          dealId, bankId,
          eventKey: "spread.invariant.violations",
          uiState: "error",
          uiMessage: `Spread invariant violations detected: ${violations.length}`,
          meta: { jobId, violations },
        });
      }
    } catch {
      // Invariant check is diagnostic — never block the success path
    }

    await logLedgerEvent({
      dealId, bankId,
      eventKey: "spread.run.succeeded",
      uiState: "done",
      uiMessage: `Spread generation completed: ${requested.join(", ")}`,
      meta: { jobId, spreadTypes: requested },
    });

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

    await logLedgerEvent({
      dealId, bankId,
      eventKey: "spread.run.failed",
      uiState: "error",
      uiMessage: `Spread generation failed: ${errMsg.slice(0, 200)}`,
      meta: { jobId, error: errMsg, attempt },
    });

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
