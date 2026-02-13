import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Condition-based finding reconciliation.
 *
 * When a spread transitions to ready or error, resolve all open findings
 * for that deal+spread_type that reference the stuck-generating condition.
 * Fire-and-forget. Never throws.
 */
export async function reconcileAegisFindingsForSpread(opts: {
  dealId: string;
  bankId: string;
  spreadType: string;
  newStatus: "ready" | "error";
}): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Find open findings for this spread's stuck-generating condition
    const { data: findings } = await sb
      .from("buddy_system_events" as any)
      .select("id")
      .eq("deal_id", opts.dealId)
      .eq("bank_id", opts.bankId)
      .in("resolution_status", ["open", "retrying"])
      .in("event_type", ["stuck_job", "warning"])
      .contains("payload" as any, { spread_type: opts.spreadType } as any);

    if (!findings || findings.length === 0) return;

    const ids = (findings as any[]).map((f) => f.id);

    await sb
      .from("buddy_system_events" as any)
      .update({
        resolution_status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: "system:spread_state_machine",
        resolution_note: `Spread ${opts.spreadType} → ${opts.newStatus}`,
      } as any)
      .in("id", ids)
      .in("resolution_status", ["open", "retrying"]); // CAS: don't re-resolve
  } catch (err: any) {
    console.warn("[reconcileAegisFindingsForSpread] non-fatal:", err?.message);
  }
}
