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

export type BootstrapResult = {
  ok: boolean;
  created: boolean;
  error?: string;
};

export async function bootstrapDealLifecycle(
  dealId: string,
  opts?: { stage?: string },
): Promise<BootstrapResult> {
  try {
    const sb = supabaseAdmin();
    const stage = opts?.stage ?? "intake";

    // Upsert with ON CONFLICT DO NOTHING — idempotent
    const { data, error } = await sb
      .from("deal_status")
      .upsert(
        {
          deal_id: dealId,
          stage,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id", ignoreDuplicates: true },
      )
      .select("deal_id")
      .maybeSingle();

    if (error) {
      console.warn("[bootstrapDealLifecycle] upsert failed (non-fatal)", {
        dealId,
        error: error.message,
      });
      return { ok: false, created: false, error: error.message };
    }

    // If data is returned, a new row was created. If null, it already existed.
    const created = data !== null;

    if (created) {
      console.log("[bootstrapDealLifecycle] created deal_status row", { dealId, stage });
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
