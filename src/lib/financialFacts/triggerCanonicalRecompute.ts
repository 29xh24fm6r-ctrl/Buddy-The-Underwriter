/**
 * SPEC-FOUNDATION-V1 PR5b — Canonical Recompute Trigger.
 *
 * Wraps enqueueSpreadRecompute with:
 *   - In-memory debounce (5s default) to coalesce rapid triggers
 *   - Canonical ledger emission for operator traceability
 *   - Structured result with triggered/debounced/error states
 *
 * Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B
 *
 * Three trigger reasons:
 *   - extraction_batch_complete: after spreadsProcessor finishes all extractions
 *   - structural_pricing_updated: after banker changes loan terms
 *   - banker_initiated_refresh: wraps existing banker-facing recompute paths
 *   - manual_diagnostic: one-off diagnostic triggers
 */

import "server-only";

import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SpreadType } from "@/lib/financialSpreads/types";

// ── Types ──────────────────────────────────────────────────────────────────

export type CanonicalRecomputeTriggerReason =
  | "extraction_batch_complete"
  | "structural_pricing_updated"
  | "banker_initiated_refresh"
  | "manual_diagnostic";

export type TriggerCanonicalRecomputeResult = {
  ok: boolean;
  triggered: boolean;
  debounced?: boolean;
  jobId?: string;
  error?: string;
};

// ── In-memory debounce ─────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 5000;
const debounceMap = new Map<string, number>();

function shouldDebounce(key: string, debounceMs: number): boolean {
  const now = Date.now();
  const lastTriggered = debounceMap.get(key);
  if (lastTriggered && now - lastTriggered < debounceMs) {
    return true;
  }
  debounceMap.set(key, now);
  return false;
}

// Exported for testing — allows clearing the debounce map between tests
export function _resetDebounceMapForTesting(): void {
  debounceMap.clear();
}

// ── Main function ──────────────────────────────────────────────────────────

export async function triggerCanonicalRecompute(args: {
  dealId: string;
  bankId: string;
  reason: CanonicalRecomputeTriggerReason;
  spreadTypes?: SpreadType[];
  debounceMs?: number;
  meta?: Record<string, unknown>;
}): Promise<TriggerCanonicalRecomputeResult> {
  const {
    dealId,
    bankId,
    reason,
    spreadTypes = ["GLOBAL_CASH_FLOW"] as SpreadType[],
    debounceMs = DEFAULT_DEBOUNCE_MS,
    meta: extraMeta,
  } = args;

  const debounceKey = `${dealId}:${spreadTypes.sort().join(",")}`;

  try {
    // Check debounce
    if (shouldDebounce(debounceKey, debounceMs)) {
      return { ok: true, triggered: false, debounced: true };
    }

    // Enqueue the spread recompute
    const result = await enqueueSpreadRecompute({
      dealId,
      bankId,
      spreadTypes,
      meta: {
        triggerReason: reason,
        ...(extraMeta ?? {}),
      },
    });

    const jobId = (result as any)?.jobId ?? null;

    // Emit canonical ledger event
    const sb = supabaseAdmin();
    const eventKey =
      (result as any)?.waitingOnFacts === true
        ? "canonical.recompute.waiting_on_facts"
        : "canonical.recompute.triggered";

    void logPipelineLedger(sb, {
      deal_id: dealId,
      bank_id: bankId,
      event_key: eventKey,
      status: "ok",
      payload: {
        reason,
        spreadTypes,
        jobId,
        ...((result as any)?.waitingOnFacts === true
          ? { waitingOnFacts: true }
          : {}),
        ...(extraMeta ?? {}),
      },
    }).catch(() => {});

    return {
      ok: true,
      triggered: true,
      jobId: jobId ?? undefined,
    };
  } catch (err: any) {
    console.warn("[triggerCanonicalRecompute] failed (non-fatal)", {
      dealId,
      reason,
      error: err?.message,
    });
    return {
      ok: false,
      triggered: false,
      error: err?.message ?? String(err),
    };
  }
}
