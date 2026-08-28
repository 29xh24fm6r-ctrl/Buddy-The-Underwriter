import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { fireWebhook } from "@/lib/webhooks/fireWebhook";
import { scheduleReadinessRefresh } from "@/lib/deals/readiness/refreshDealReadiness";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import { LedgerEventType } from "@/buddy/lifecycle/events";
import { getSatisfiedRequired, getMissingRequired } from "@/lib/deals/checklistSatisfaction";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealBankAccessGrant } from "@/lib/tenant/ensureDealBankAccess";
import {
  requireCountResult,
  requireDataResult,
  requireMutationRow,
  requireNoError,
  requireWriteEventResult,
} from "@/lib/deals/readinessPersistence";

/**
 * 🧠 CANONICAL DEAL READINESS
 * 
 * A deal is READY iff:
 * 1. All uploads are finalized (finalized_at IS NOT NULL)
 * 2. AI pipeline has processed all documents (no queued/processing/failed artifacts)
 * 3. Checklist engine is satisfied (all required items met)
 *
 * This is the SINGLE SOURCE OF TRUTH for deal completeness.
 * No UI action sets this directly - it's DERIVED.
 */

export type DealReadinessResult = {
  ready: boolean;
  reason: string;
  details?: {
    uploads_pending?: number;
    ai_pipeline_incomplete?: number;
    spread_violations?: number;
    // Phase T: entity binding readiness
    entity_count?: number;
    unbound_entity_scoped_slots?: number;
    // Checklist
    required_items_missing?: number;
    checklist_total?: number;
    checklist_satisfied?: number;
  };
};

/**
 * Compute canonical deal readiness state
 */
export async function computeDealReadiness(
  dealId: string
): Promise<DealReadinessResult> {
  const sb = supabaseAdmin();

  // 1. Check for genuinely unfinalized uploads — only UPLOADED/LOCKED_FOR_PROCESSING.
  // CLASSIFIED_PENDING_REVIEW and beyond means the doc is processed; finalized_at
  // null on those is a stale artifact, not actual incompleteness.
  const uploadsQuery = await sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .is("finalized_at", null)
    .in("intake_status", ["UPLOADED", "LOCKED_FOR_PROCESSING"]);
  const uploadsPending = requireCountResult(
    uploadsQuery,
    "readiness_upload_count_failed",
  );

  if (uploadsPending > 0) {
    return {
      ready: false,
      reason: `Uploads processing (${uploadsPending} remaining)`,
      details: { uploads_pending: uploadsPending },
    };
  }

  // 2. AI pipeline must have processed all documents (prevents "green lies")
  const aiQuery = await sb
    .from("document_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .in("status", ["queued", "processing", "failed"]);
  const aiIncomplete = requireCountResult(
    aiQuery,
    "readiness_artifact_count_failed",
  );

  if (aiIncomplete > 0) {
    return {
      ready: false,
      reason: `AI pipeline incomplete (${aiIncomplete} document(s) still processing)`,
      details: { ai_pipeline_incomplete: aiIncomplete },
    };
  }

  // 2b. Spread invariant — all classified docs should have completed spreads
  const spreadQuery = await (sb as any).rpc(
    "assert_spread_invariant",
    { p_deal_id: dealId },
  );
  const violations = requireDataResult<any[]>(
    spreadQuery,
    "readiness_spread_invariant_failed",
  );
  const missing = violations.filter(
    (v: any) => v.reason === "missing_spread",
  );
  if (missing.length > 0) {
    return {
      ready: false,
      reason: `Spread invariant violated: ${missing.length} missing spread(s)`,
      details: {
        spread_violations: missing.length,
      },
    };
  }

  // 2c. Entity binding — multi-entity deals must have all entity-scoped slots bound
  try {
    const { getEntityBindingStatus } = await import(
      "@/lib/intake/slots/getEntityBindingStatus"
    );
    const bindingStatus = await getEntityBindingStatus(dealId);
    if (bindingStatus.entityBindingRequired) {
      return {
        ready: false,
        reason: `Entity binding incomplete (${bindingStatus.unboundEntityScopedSlotCount} unbound entity-scoped slot(s) on multi-entity deal)`,
        details: {
          entity_count: bindingStatus.entityCount,
          unbound_entity_scoped_slots: bindingStatus.unboundEntityScopedSlotCount,
        },
      };
    }
  } catch (error) {
    throw new Error(
      `readiness_entity_binding_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 3. Check checklist satisfaction
  const checklistQuery = await sb
    .from("deal_checklist_items")
    .select("required, status, checklist_key, required_years, satisfied_years")
    .eq("deal_id", dealId);
  const checklist = requireDataResult<any[]>(
    checklistQuery,
    "readiness_checklist_read_failed",
  );

  if (checklist.length === 0) {
    return {
      ready: false,
      reason: "Checklist not initialized",
      details: { checklist_total: 0 },
    };
  }

  const satisfiedRequired = getSatisfiedRequired(checklist);
  const missingItems = getMissingRequired(checklist);
  let missingRequired = missingItems.length;

  // SPEC-OUTSTANDING-FIXES-BATCH-1 Fix 7: Tax year tolerance.
  // If the ONLY missing required items are tax returns for the current-prior
  // year (e.g. 2025 returns in May 2026 — filed but borrower hasn't provided),
  // treat the requirement as substantially met for stage advancement.
  // The checklist still shows the missing year so bankers know to collect it.
  if (missingRequired > 0) {
    const currentTaxYear = new Date().getMonth() >= 3
      ? new Date().getFullYear() - 1
      : new Date().getFullYear() - 2;
    const currentYearSuffix = `_${currentTaxYear}`;

    const nonTolerableMissing = missingItems.filter((item: any) => {
      const key = (item.checklist_key ?? "") as string;
      // Tolerate missing IRS_BUSINESS_<year> and IRS_PERSONAL_<year> for current tax year only
      if (key.endsWith(currentYearSuffix)) {
        const prefix = key.replace(currentYearSuffix, "");
        if (prefix === "IRS_BUSINESS" || prefix === "IRS_PERSONAL") {
          return false; // tolerable — don't count as blocking
        }
      }
      return true; // non-tolerable — still blocks
    });

    missingRequired = nonTolerableMissing.length;

    // SPEC-READINESS-SYSTEM-UNIFICATION-1: PFS_CURRENT tolerance.
    // If PFS_CURRENT is missing but a finalized PFS doc exists, treat as
    // non-blocking. Reconciliation (System B) will fix the status.
    if (nonTolerableMissing.some((i: any) => i.checklist_key === "PFS_CURRENT")) {
      const pfsQuery = await sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .in("canonical_type", ["PFS", "PERSONAL_FINANCIAL_STATEMENT"])
        .not("finalized_at", "is", null);
      const pfsCount = requireCountResult(
        pfsQuery,
        "readiness_pfs_count_failed",
      );

      if (pfsCount > 0) {
        missingRequired = nonTolerableMissing.filter(
          (i: any) => i.checklist_key !== "PFS_CURRENT",
        ).length;
      }
    }
  }

  if (missingRequired > 0) {
    return {
      ready: false,
      reason: `Checklist incomplete (${missingRequired} items missing)`,
      details: {
        required_items_missing: missingRequired,
        checklist_total: checklist.length,
        checklist_satisfied: satisfiedRequired.length,
      },
    };
  }

  // All checks passed
  return {
    ready: true,
    reason: "Deal complete",
    details: {
      checklist_total: checklist.length,
      checklist_satisfied: satisfiedRequired.length,
    },
  };
}

/**
 * Recompute and persist deal readiness state
 * 
 * Call this after ANY event that might change readiness:
 * - Document finalized
 * - Checklist reconciled
 * - Auto-seed run
 * - Manual checklist update
 * 
 * 🔔 Fires webhooks on readiness transition (null → set)
 */
export type RecomputeDealReadyContext = {
  actorId?: string;
  accessGrant?: DealBankAccessGrant;
};

export async function recomputeDealReady(
  dealId: string,
  context: RecomputeDealReadyContext = {},
): Promise<void> {
  const sb = supabaseAdmin();
  
  // Fetch current state (for transition detection)
  const currentDealQuery = await sb
    .from("deals")
    .select("ready_at, ready_reason, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  const currentDeal = requireDataResult<{
    ready_at: string | null;
    ready_reason: string | null;
    bank_id: string | null;
  }>(currentDealQuery, "readiness_deal_read_failed");
  if (!currentDeal.bank_id) {
    throw new Error("readiness_deal_bank_missing");
  }

  const wasReady = !!currentDeal.ready_at;

  // SPEC-READINESS-SYSTEM-UNIFICATION-1: Reconcile checklist synchronously
  // before evaluating readiness. Without this, checklist status is stale and
  // computeDealReadiness sees missing items even when docs exist.
  try {
    const { reconcileChecklistForDeal } = await import("@/lib/checklist/engine");
    const sb2 = supabaseAdmin();
    await reconcileChecklistForDeal({
      sb: sb2,
      dealId,
      actorId: context.actorId,
      accessGrant: context.accessGrant,
    });
  } catch (reconcileErr: any) {
    throw new Error(
      `readiness_checklist_reconcile_failed: ${reconcileErr?.message ?? String(reconcileErr)}`,
    );
  }

  const result = await computeDealReadiness(dealId);

  if (result.ready) {
    // Atomic conditional update — only set ready_at if currently null.
    // This prevents duplicate webhooks when concurrent calls both see wasReady=false.
    const readyAt = new Date().toISOString();
    const readyUpdate = await sb
      .from("deals")
      .update({
        ready_at: readyAt,
        ready_reason: result.reason,
      })
      .eq("id", dealId)
      .is("ready_at", null)
      .select("id")
      .maybeSingle();
    requireNoError(readyUpdate, "readiness_ready_update_failed");
    const updated = readyUpdate.data;

    const persistedReadyQuery = await sb
      .from("deals")
      .select("id, ready_at, ready_reason")
      .eq("id", dealId)
      .maybeSingle();
    const persistedReady = requireDataResult<{
      id: string;
      ready_at: string | null;
      ready_reason: string | null;
    }>(persistedReadyQuery, "readiness_ready_readback_failed");
    if (!persistedReady.ready_at || persistedReady.ready_reason !== result.reason) {
      throw new Error("readiness_ready_persistence_unproven");
    }

    const pipelineInsert = await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: currentDeal.bank_id,
      stage: "readiness",
      status: "completed",
      payload: {
        ready_at: readyAt,
        ...result.details,
      },
    });
    if (pipelineInsert.error) {
      if (updated) {
        const rollback = await sb
          .from("deals")
          .update({
            ready_at: null,
            ready_reason: "Readiness evidence persistence failed",
          })
          .eq("id", dealId)
          .eq("ready_at", readyAt)
          .select("id")
          .maybeSingle();
        requireMutationRow(rollback, "readiness_ready_rollback_failed");
      }
      requireNoError(pipelineInsert, "readiness_pipeline_insert_failed");
    }

    // Pulse: readiness recomputed
    void emitPipelineEvent({
      kind: "readiness_recomputed",
      deal_id: dealId,
      bank_id: currentDeal.bank_id,
      payload: {
        ready: true,
        ready_reason: result.reason,
        status: "completed",
      },
    });

    // Fire ONLY if we actually transitioned (atomic guard won the race)
    if (updated) {
      await fireWebhook("deal.ready", {
        deal_id: dealId,
        bank_id: currentDeal.bank_id,
        data: {
          ready_at: readyAt,
          ...result.details,
        },
      });
    }

    // Phase 12B: fire comms lifecycle hook on ready transition
    if (updated) {
      void import("@/lib/brokerage/commsLifecycleHooks")
        .then((m) => m.handleLifecycleHook({ dealId, event: "deal_ready_for_review" }, sb))
        .catch(() => {});
    }

    // Lifecycle advancement is part of readiness convergence. Invalid stage
    // transitions are benign (another stage owner may already have advanced),
    // while persistence and evidence failures remain explicit.
    try {
      // SPEC-OUTSTANDING-FIXES-BATCH-1: collecting → underwriting is the valid
      // transition. "ready" is not a valid toStage from "collecting" per
      // ALLOWED_TRANSITIONS. The UI stage label is "Memo Inputs Required"
      // which maps to the underwriting stage in the lifecycle model.
      const lifecycleResult = await advanceDealLifecycle({
        dealId,
        toStage: "underwriting",
        reason: "deal_ready",
        source: "readiness",
        actor: { userId: null, type: "system", label: "readiness" },
      });
      if (
        !lifecycleResult.ok &&
        lifecycleResult.error !== "invalid_transition" &&
        lifecycleResult.error !== "use_ignite"
      ) {
        throw new Error(
          `readiness_lifecycle_advance_failed: ${lifecycleResult.error}`,
        );
      }
    } catch (error) {
      throw new Error(
        `readiness_lifecycle_advance_failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // Deal not ready - persist and prove the cleared timestamp and reason.
    const clearUpdate = await sb
      .from("deals")
      .update({
        ready_at: null,
        ready_reason: result.reason,
      })
      .eq("id", dealId)
      .select("id, ready_at, ready_reason")
      .maybeSingle();
    const clearedDeal = requireMutationRow<{
      id: string;
      ready_at: string | null;
      ready_reason: string | null;
    }>(clearUpdate, "readiness_clear_update_failed");
    if (clearedDeal.ready_at !== null || clearedDeal.ready_reason !== result.reason) {
      throw new Error("readiness_clear_persistence_unproven");
    }

    // Write reverted event if deal was previously ready. If evidence fails,
    // restore the prior authoritative state so a later retry can converge.
    if (wasReady) {
      const { writeEvent } = await import("@/lib/ledger/writeEvent");
      const revertedEvent = await writeEvent({
        dealId,
        kind: LedgerEventType.ready_reverted,
        actorUserId: null,
        input: { reason: result.reason },
      });
      if (!revertedEvent.ok) {
        const rollback = await sb
          .from("deals")
          .update({
            ready_at: currentDeal.ready_at,
            ready_reason: currentDeal.ready_reason,
          })
          .eq("id", dealId)
          .is("ready_at", null)
          .eq("ready_reason", result.reason)
          .select("id")
          .maybeSingle();
        requireMutationRow(rollback, "readiness_regression_rollback_failed");
        requireWriteEventResult(
          revertedEvent,
          "readiness_reverted_event_failed",
        );
      }

      // Phase 12B: fire comms lifecycle hook on readiness regression
      void import("@/lib/brokerage/commsLifecycleHooks")
        .then((m) => m.handleLifecycleHook({ dealId, event: "readiness_regressed" }, sb))
        .catch(() => {});
    }

    // SPEC-READINESS-SYSTEM-UNIFICATION-1: Always fire System B regardless of
    // System A's gate result. This is scheduled only after the authoritative
    // not-ready state and any required regression evidence are durable.
    scheduleReadinessRefresh({
      dealId,
      trigger: "financial_facts_written",
      actorId: context.actorId,
      accessGrant: context.accessGrant,
    });
  }
}

/**
 * Get current deal readiness state (cached in deals table)
 */
export async function getDealReadiness(
  dealId: string
): Promise<{ ready: boolean; reason: string | null }> {
  const sb = supabaseAdmin();
  const readinessQuery = await sb
    .from("deals")
    .select("ready_at, ready_reason")
    .eq("id", dealId)
    .maybeSingle();
  const data = requireDataResult<{
    ready_at: string | null;
    ready_reason: string | null;
  }>(readinessQuery, "readiness_cached_read_failed");

  return {
    ready: !!data.ready_at,
    reason: data.ready_reason ?? null,
  };
}
