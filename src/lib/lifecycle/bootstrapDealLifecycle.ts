/**
 * bootstrapDealLifecycle — Idempotent lifecycle bootstrap.
 *
 * Ensures a deal_status row exists for the given deal. Uses upsert
 * with ON CONFLICT DO NOTHING so it's safe to call multiple times,
 * from any context, at any point in the deal's life.
 *
 * Primary trigger: DB trigger `trg_auto_create_deal_status` on deals INSERT.
 * This function is the DEFENSIVE FALLBACK for deals that predate the trigger
 * or where the trigger somehow failed.
 *
 * Guarantees:
 *   - Idempotent (safe to call N times)
 *   - Never throws (fire-and-forget safe)
 *   - Does not overwrite existing deal_status rows
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type BootstrapResult = {
  ok: boolean;
  created: boolean;
  error?: string;
};

export async function bootstrapDealLifecycle(
  dealId: string,
  opts?: { stage?: string; bankId?: string },
): Promise<BootstrapResult> {
  try {
    const sb = supabaseAdmin();
    const stage = opts?.stage ?? "intake";

    // Check if row already exists
    const { data: existing } = await sb
      .from("deal_status")
      .select("deal_id")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (existing) {
      return { ok: true, created: false };
    }

    // Insert new row (no upsert — avoids PostgREST 406 on ignoreDuplicates + select)
    const { error } = await sb
      .from("deal_status")
      .insert({
        deal_id: dealId,
        stage,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      // Race condition: another process created it between our check and insert
      if (error.code === "23505") {
        return { ok: true, created: false };
      }
      console.warn("[bootstrapDealLifecycle] insert failed (non-fatal)", {
        dealId,
        error: error.message,
      });
      return { ok: false, created: false, error: error.message };
    }

    const created = true;

    if (created) {
      console.log("[bootstrapDealLifecycle] created deal_status row", { dealId, stage });

      // Emit ledger event for traceability (fire-and-forget)
      void logLedgerEvent({
        dealId,
        bankId: opts?.bankId ?? "unknown",
        eventKey: "deal.lifecycle.bootstrapped",
        uiState: "done",
        uiMessage: "Lifecycle status row auto-created (self-heal)",
        meta: { stage, source: "bootstrapDealLifecycle" },
      }).catch(() => {});
    }

    return { ok: true, created };
  } catch (err: any) {
    console.warn("[bootstrapDealLifecycle] failed (non-fatal)", {
      dealId,
      error: err?.message,
    });
    return { ok: false, created: false, error: err?.message ?? "unknown" };
  }
}
