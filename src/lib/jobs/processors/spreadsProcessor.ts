import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { renderSpread } from "@/lib/financialSpreads/renderSpread";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { classifySpreadError } from "@/lib/financialSpreads/spreadErrorCodes";
import { reconcileAegisFindingsForSpread } from "@/lib/aegis/reconcileSpreadFindings";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";
import { writeSystemEvent } from "@/lib/aegis";
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";
import { evaluatePrereq } from "@/lib/financialSpreads/evaluatePrereq";

const LEASE_MS = 3 * 60 * 1000;

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

/** Derive the correct owner_type from the spread type, not from job meta. */
function resolveOwnerType(spreadType: string, metaOwnerType?: string): string {
  if (spreadType === "PERSONAL_INCOME" || spreadType === "PERSONAL_FINANCIAL_STATEMENT") {
    return "PERSONAL";
  }
  if (spreadType === "GLOBAL_CASH_FLOW") {
    return metaOwnerType ?? "GLOBAL";
  }
  return "DEAL";
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

  // Hoisted for catch block visibility
  const requested = uniq((job.requested_spread_types ?? []) as string[])
    .map((s) => String(s))
    .filter(Boolean) as SpreadType[];

  // A3: Deterministic ordering — lower priority runs first.
  requested.sort((a, b) => {
    const pa = getSpreadTemplate(a)?.priority ?? 99;
    const pb = getSpreadTemplate(b)?.priority ?? 99;
    return pa - pb;
  });

  const jobMeta = (job.meta && typeof job.meta === "object") ? job.meta : {};
  const ownerType = typeof jobMeta.owner_type === "string" ? jobMeta.owner_type : undefined;
  const ownerEntityId = typeof jobMeta.owner_entity_id === "string" ? jobMeta.owner_entity_id : SENTINEL_UUID;
  const completedTypes = new Set<string>();
  let skippedMissingTemplate = 0;
  let skippedMissingPlaceholder = 0;

  try {
    const sourceDocumentId = job.source_document_id ? String(job.source_document_id) : null;

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
    } else {
      // Job merge lost source_document_id — re-extract from ALL deal documents
      // using EXTRACTION_HEARTBEAT facts as the document roster + doc type hints.
      const { data: heartbeats } = await (sb as any)
        .from("deal_financial_facts")
        .select("source_document_id, fact_value_text")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("fact_type", "EXTRACTION_HEARTBEAT");

      let docsExtracted = 0;
      if (heartbeats?.length) {
        for (const hb of heartbeats) {
          try {
            await extractFactsFromDocument({
              dealId,
              bankId,
              documentId: String(hb.source_document_id),
              docTypeHint: hb.fact_value_text ?? undefined,
            });
            docsExtracted++;
          } catch (extractErr: any) {
            console.warn(`[spreadsProcessor] re-extract failed for ${hb.source_document_id}:`, extractErr?.message);
          }
        }
      }

      if (docsExtracted > 0) {
        await logLedgerEvent({
          dealId, bankId,
          eventKey: "spread.inputs.collected",
          uiState: "working",
          uiMessage: `Financial facts re-extracted from ${docsExtracted} document(s)`,
          meta: { jobId, docsExtracted, totalHeartbeats: heartbeats?.length ?? 0 },
        });
      }
    }

    const runId = jobId; // canonical run identifier for CAS ownership

    // ── Preflight: heartbeat-aware bounded retry + per-spread prereq eval ──
    const [factsVis, heartbeatRes, rentRollRes] = await Promise.all([
      getVisibleFacts(dealId, bankId),
      (sb as any)
        .from("deal_financial_facts")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("fact_type", "EXTRACTION_HEARTBEAT"),
      (sb as any)
        .from("deal_rent_roll_rows")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
    ]);

    const heartbeatExists = (heartbeatRes.count ?? 0) > 0;
    const rentRollRowCount = rentRollRes.count ?? 0;

    if (factsVis.total === 0 && !heartbeatExists) {
      // Timing race — extraction hasn't run yet. Bounded retry.
      const preflightRetries = typeof jobMeta.preflight_retries === "number" ? jobMeta.preflight_retries : 0;

      if (preflightRetries < 5) {
        const nextRunAt = new Date(Date.now() + 30_000).toISOString();
        await (sb as any)
          .from("deal_spread_jobs")
          .update({
            status: "QUEUED",
            next_run_at: nextRunAt,
            meta: { ...jobMeta, preflight_retries: preflightRetries + 1 },
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        writeSystemEvent({
          event_type: "info",
          severity: "info",
          source_system: "spreads_processor",
          source_job_id: jobId,
          source_job_table: "deal_spread_jobs",
          deal_id: dealId,
          bank_id: bankId,
          error_code: "SPREAD_JOB_DEFERRED_WAITING_ON_EXTRACTION",
          error_message: `Deferred spread job (retry ${preflightRetries + 1}/5): no facts and no extraction heartbeat yet`,
          payload: { jobId, dealId, preflightRetries: preflightRetries + 1 },
        }).catch(() => {});

        return { ok: true as const, jobId, deferred: true as const };
      }

      // Max retries exceeded
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "FAILED",
          error: "NO_FACTS_AFTER_RETRIES: extraction never produced facts after 5 attempts",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      writeSystemEvent({
        event_type: "error",
        severity: "error",
        source_system: "spreads_processor",
        source_job_id: jobId,
        source_job_table: "deal_spread_jobs",
        deal_id: dealId,
        bank_id: bankId,
        error_class: "permanent",
        error_code: "SPREAD_JOB_NO_FACTS_TIMEOUT",
        error_message: "Spread job abandoned after 5 preflight retries — no extraction heartbeat found",
        payload: { jobId, dealId },
      }).catch(() => {});

      return { ok: false as const, error: "NO_FACTS_AFTER_RETRIES" };
    }

    if (factsVis.total === 0 && heartbeatExists) {
      // Extraction ran but produced 0 visible facts — emit diagnostic event
      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "spreads_processor",
        source_job_id: jobId,
        source_job_table: "deal_spread_jobs",
        deal_id: dealId,
        bank_id: bankId,
        error_code: "EXTRACTION_ZERO_FACTS",
        error_message: "Extraction completed (heartbeat present) but produced 0 visible facts",
        payload: { dealId, bankId, jobId },
      }).catch(() => {});
    }

    // ── Per-spread prerequisite evaluation ──
    const readyTypes: SpreadType[] = [];
    const notReadyTypes: Array<{ type: SpreadType; missing: string[]; note?: string }> = [];
    let skippedPrereqs = 0;

    for (const spreadType of requested) {
      const tpl = getSpreadTemplate(spreadType);
      if (!tpl) continue; // Will be caught by template guard below

      const prereq = tpl.prerequisites();
      const { ready, missing } = evaluatePrereq(prereq, factsVis, rentRollRowCount);

      if (ready) {
        readyTypes.push(spreadType);
      } else {
        notReadyTypes.push({ type: spreadType, missing, note: prereq.note });
        skippedPrereqs++;
      }
    }

    // Emit events for not-ready types — they stay queued or get MISSING_UPSTREAM_FACTS
    for (const nr of notReadyTypes) {
      const effectiveOwnerType = resolveOwnerType(nr.type, ownerType);

      if (heartbeatExists) {
        // Extraction ran but didn't produce facts for this type — genuine absence
        await (sb as any)
          .from("deal_spreads")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error: `Prerequisites not met: ${nr.missing.join(", ")}`,
            error_code: "MISSING_UPSTREAM_FACTS",
            error_details_json: { dealId, bankId, missing: nr.missing, note: nr.note },
            updated_at: new Date().toISOString(),
          })
          .eq("deal_id", dealId)
          .eq("bank_id", bankId)
          .eq("spread_type", nr.type)
          .eq("owner_type", effectiveOwnerType)
          .eq("owner_entity_id", ownerEntityId)
          .in("status", ["queued", "generating"]);

        reconcileAegisFindingsForSpread({ dealId, bankId, spreadType: nr.type, newStatus: "error" }).catch(() => {});
      }

      writeSystemEvent({
        event_type: "info",
        severity: "info",
        source_system: "spreads_processor",
        source_job_id: jobId,
        source_job_table: "deal_spread_jobs",
        deal_id: dealId,
        bank_id: bankId,
        error_code: "SPREAD_WAITING_ON_FACTS",
        error_message: `${nr.type} prerequisites not met: ${nr.missing.join(", ")}`,
        payload: { spreadType: nr.type, missing: nr.missing, note: nr.note, jobId },
      }).catch(() => {});
    }

    for (const spreadType of readyTypes) {
      // Defense-in-depth: skip types with no registered template
      const tpl = getSpreadTemplate(spreadType);
      if (!tpl) {
        skippedMissingTemplate++;
        writeSystemEvent({
          event_type: "warning",
          severity: "warning",
          source_system: "spreads_processor",
          source_job_id: jobId,
          source_job_table: "deal_spread_jobs",
          deal_id: dealId,
          bank_id: bankId,
          error_class: "permanent",
          error_code: "SPREAD_TEMPLATE_MISSING_IN_JOB",
          error_message: `Spread type ${spreadType} has no registered template — skipped`,
          payload: { spreadType, jobId, dealId },
        }).catch(() => {});
        continue;
      }

      const effectiveOwnerType = resolveOwnerType(spreadType, ownerType);

      // CAS: transition queued→generating ONLY if no other run owns it
      // Accepts: status='queued' (no owner yet) OR status='generating' with same run_id (retry)
      // Pinned to spread_version = tpl.version for deterministic claiming.
      const { data: claimed, error: claimErr } = await (sb as any)
        .from("deal_spreads")
        .update({
          status: "generating",
          started_at: new Date().toISOString(),
          last_run_id: runId,
          error_code: null,
          error: null,
          error_details_json: null,
          updated_at: new Date().toISOString(),
        })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("spread_type", spreadType)
        .eq("spread_version", tpl.version)
        .eq("owner_type", effectiveOwnerType)
        .eq("owner_entity_id", ownerEntityId)
        .or(`status.eq.queued,and(status.eq.generating,last_run_id.eq.${runId})`)
        .select("id, attempts")
        .maybeSingle();

      if (!claimed) {
        skippedMissingPlaceholder++;
        writeSystemEvent({
          event_type: "warning",
          severity: "warning",
          source_system: "spreads_processor",
          source_job_id: jobId,
          source_job_table: "deal_spread_jobs",
          deal_id: dealId,
          bank_id: bankId,
          error_code: "SPREAD_PLACEHOLDER_MISSING",
          error_message: `No claimable placeholder for ${spreadType} v${tpl.version} — skipped`,
          payload: { spreadType, version: tpl.version, ownerType: effectiveOwnerType, ownerEntityId },
        }).catch(() => {});
        continue;
      }

      // Best-effort: increment attempts
      await (sb as any)
        .from("deal_spreads")
        .update({ attempts: (claimed.attempts ?? 0) + 1 })
        .eq("id", claimed.id)
        .catch(() => {});

      await renderSpread({ dealId, bankId, spreadType, ownerType: effectiveOwnerType, ownerEntityId });
      completedTypes.add(spreadType);

      // Fire-and-forget: reconcile findings
      reconcileAegisFindingsForSpread({ dealId, bankId, spreadType, newStatus: "ready" }).catch(() => {});

      // Empty-row invariant: mark as error if spread rendered with 0 data rows
      try {
        const effectiveOwnerTypeForCheck = resolveOwnerType(spreadType, ownerType);
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
            // A7: Empty spread = error, not warning
            await (sb as any)
              .from("deal_spreads")
              .update({
                status: "error",
                finished_at: new Date().toISOString(),
                error: `${spreadType} spread rendered with 0 data rows`,
                error_code: "EMPTY_SPREAD_RENDERED",
                error_details_json: { spreadType, spreadId: spread.id, jobId },
                updated_at: new Date().toISOString(),
              })
              .eq("id", spread.id);

            completedTypes.delete(spreadType);

            writeSystemEvent({
              deal_id: dealId,
              bank_id: bankId,
              event_type: "error",
              severity: "error",
              error_class: "permanent",
              error_code: "EMPTY_SPREAD_RENDERED",
              error_message: `${spreadType} spread rendered with 0 data rows`,
              source_system: "spreads_processor",
              source_job_id: jobId,
              source_job_table: "deal_spread_jobs",
              payload: { spreadType, spreadId: spread.id },
            }).catch(() => {});

            reconcileAegisFindingsForSpread({ dealId, bankId, spreadType, newStatus: "error" }).catch(() => {});
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

    // Compute total debt service (proposed + existing) after facts materialized
    try {
      const { computeTotalDebtService } = await import(
        "@/lib/structuralPricing/computeTotalDebtService"
      );
      const totalDebt = await computeTotalDebtService({ dealId, bankId });
      if (totalDebt.ok) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "debt.total.computed",
          uiState: "done",
          uiMessage: `Total debt: proposed $${totalDebt.data.proposed?.toFixed(0) ?? "0"}, existing $${totalDebt.data.existing?.toFixed(0) ?? "0"}`,
          meta: { jobId, ...totalDebt.data },
        });
      }
    } catch (debtErr: any) {
      console.warn("[spreadsProcessor] total debt failed (non-fatal)", {
        dealId,
        jobId,
        error: debtErr?.message,
      });
    }

    // Recompute deal readiness after facts are materialized (non-fatal)
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch (readinessErr: any) {
      console.warn("[spreadsProcessor] readiness recompute failed (non-fatal)", {
        dealId,
        jobId,
        error: readinessErr?.message,
      });
    }

    // ── Job outcome: no silent "SUCCEEDED 0 work" ──────────────────────────
    const renderedCount = completedTypes.size;
    const attemptedCount = readyTypes.length;

    if (renderedCount === 0) {
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "FAILED",
          error: `NO_SPREADS_RENDERED: ${skippedMissingTemplate} missing template, ${skippedMissingPlaceholder} missing placeholder, ${skippedPrereqs} prereqs not met`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      writeSystemEvent({
        event_type: "warning",
        severity: "warning",
        source_system: "spreads_processor",
        source_job_id: jobId,
        source_job_table: "deal_spread_jobs",
        deal_id: dealId,
        bank_id: bankId,
        error_code: "SPREAD_JOB_NOOP",
        error_message: `Job processed 0 spreads out of ${requested.length} requested (${attemptedCount} ready)`,
        payload: {
          jobId, dealId,
          requested,
          readyTypes,
          notReadyTypes: notReadyTypes.map((nr) => ({ type: nr.type, missing: nr.missing })),
          renderedCount,
          skippedMissingTemplate,
          skippedMissingPlaceholder,
          skippedPrereqs,
        },
      }).catch(() => {});
    } else {
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          status: "SUCCEEDED",
          updated_at: new Date().toISOString(),
          error: renderedCount < attemptedCount
            ? `Partial: ${renderedCount}/${attemptedCount} types rendered`
            : null,
        })
        .eq("id", jobId);

      if (renderedCount < attemptedCount) {
        writeSystemEvent({
          event_type: "warning",
          severity: "info",
          source_system: "spreads_processor",
          source_job_id: jobId,
          source_job_table: "deal_spread_jobs",
          deal_id: dealId,
          bank_id: bankId,
          error_code: "SPREAD_JOB_PARTIAL",
          error_message: `${renderedCount}/${attemptedCount} types rendered`,
          payload: {
            jobId, dealId,
            requested,
            completed: Array.from(completedTypes),
            skippedMissingTemplate,
            skippedMissingPlaceholder,
          },
        }).catch(() => {});
      }
    }

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

    // NON-NEGOTIABLE: clean up spread status for types that didn't complete
    const runId = jobId;
    const failedTypes = requested.filter((t) => !completedTypes.has(t));
    for (const spreadType of failedTypes) {
      const effectiveOwnerType = resolveOwnerType(spreadType, ownerType);
      const failTpl = getSpreadTemplate(spreadType);
      const failVersion = failTpl?.version ?? 1; // fallback to 1 for unknown types
      await (sb as any)
        .from("deal_spreads")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error: errMsg.slice(0, 500),
          error_code: classifySpreadError(e),
          error_details_json: {
            exceptionName: e?.name ?? "Error",
            runId,
            jobId,
            attempt,
            spreadType,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("spread_type", spreadType)
        .eq("spread_version", failVersion)  // Pin to template version
        .eq("owner_type", effectiveOwnerType)
        .eq("owner_entity_id", ownerEntityId)
        .eq("last_run_id", runId)       // STRICT CAS: only if we own this run
        .eq("status", "generating");    // STRICT CAS: only if still generating

      reconcileAegisFindingsForSpread({ dealId, bankId, spreadType, newStatus: "error" }).catch(() => {});
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
