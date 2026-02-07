import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { fireWebhook } from "@/lib/webhooks/fireWebhook";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import { LedgerEventType } from "@/buddy/lifecycle/events";
import { getSatisfiedRequired, getMissingRequired } from "@/lib/deals/checklistSatisfaction";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  // 1. Check for in-flight uploads
  const { count: uploadsPending } = await sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .is("finalized_at", null);

  if (uploadsPending && uploadsPending > 0) {
    return {
      ready: false,
      reason: `Uploads processing (${uploadsPending} remaining)`,
      details: { uploads_pending: uploadsPending },
    };
  }

  // 2. AI pipeline must have processed all documents (prevents "green lies")
  const { count: aiIncomplete } = await sb
    .from("document_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .in("status", ["queued", "processing", "failed"]);

  if (aiIncomplete && aiIncomplete > 0) {
    return {
      ready: false,
      reason: `AI pipeline incomplete (${aiIncomplete} document(s) still processing)`,
      details: { ai_pipeline_incomplete: aiIncomplete },
    };
  }

  // 3. Check checklist satisfaction
  const { data: checklist } = await sb
    .from("deal_checklist_items")
    .select("required, status")
    .eq("deal_id", dealId);

  if (!checklist || checklist.length === 0) {
    return {
      ready: false,
      reason: "Checklist not initialized",
      details: { checklist_total: 0 },
    };
  }

  const satisfiedRequired = getSatisfiedRequired(checklist);
  const missingRequired = getMissingRequired(checklist).length;

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
export async function recomputeDealReady(dealId: string): Promise<void> {
  const sb = supabaseAdmin();
  
  // Fetch current state (for transition detection)
  const { data: currentDeal } = await sb
    .from("deals")
    .select("ready_at, bank_id")
    .eq("id", dealId)
    .single();

  const wasReady = !!currentDeal?.ready_at;
  const result = await computeDealReadiness(dealId);

  if (result.ready) {
    // Atomic conditional update — only set ready_at if currently null.
    // This prevents duplicate webhooks when concurrent calls both see wasReady=false.
    const { data: updated } = await sb
      .from("deals")
      .update({
        ready_at: new Date().toISOString(),
        ready_reason: result.reason,
      })
      .eq("id", dealId)
      .is("ready_at", null)
      .select("id")
      .maybeSingle();

    // Log to pipeline ledger
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: null, // Will be backfilled by trigger if needed
      stage: "readiness",
      status: "completed",
      payload: {
        ready_at: new Date().toISOString(),
        ...result.details,
      },
    });

    // Pulse: readiness recomputed
    void emitPipelineEvent({
      kind: "readiness_recomputed",
      deal_id: dealId,
      bank_id: currentDeal?.bank_id ?? undefined,
      payload: {
        ready: true,
        ready_reason: result.reason,
        status: "completed",
      },
    });

    // Fire ONLY if we actually transitioned (atomic guard won the race)
    if (updated && currentDeal?.bank_id) {
      await fireWebhook("deal.ready", {
        deal_id: dealId,
        bank_id: currentDeal.bank_id,
        data: {
          ready_at: new Date().toISOString(),
          ...result.details,
        },
      });
    }

    // Best-effort lifecycle advancement — advanceDealLifecycle has its own
    // internal stage guard (ALLOWED_TRANSITIONS), so this is safe to call
    // unconditionally. Wrapped in try/catch because stage column
    // may not exist in all environments and this must not break readiness.
    try {
      await advanceDealLifecycle({
        dealId,
        toStage: "ready",
        reason: "deal_ready",
        source: "readiness",
        actor: { userId: null, type: "system", label: "readiness" },
      });
    } catch {
      // Non-fatal: lifecycle advancement is best-effort
    }
  } else {
    // Deal not ready - clear timestamp, update reason
    await sb
      .from("deals")
      .update({
        ready_at: null,
        ready_reason: result.reason,
      })
      .eq("id", dealId);

    // Write reverted event if deal was previously ready
    if (wasReady) {
      const { writeEvent } = await import("@/lib/ledger/writeEvent");
      await writeEvent({
        dealId,
        kind: LedgerEventType.ready_reverted,
        actorUserId: null,
        input: { reason: result.reason },
      });
    }
  }
}

/**
 * Get current deal readiness state (cached in deals table)
 */
export async function getDealReadiness(
  dealId: string
): Promise<{ ready: boolean; reason: string | null }> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deals")
    .select("ready_at, ready_reason")
    .eq("id", dealId)
    .single();

  return {
    ready: !!data?.ready_at,
    reason: data?.ready_reason ?? null,
  };
}
