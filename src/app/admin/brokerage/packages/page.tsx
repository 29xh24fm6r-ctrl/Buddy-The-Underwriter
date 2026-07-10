import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadLastEvents } from "../_components/loadLastEvents";
import { StuckTable, type StuckRow } from "../_components/StuckTable";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

/**
 * Active sealed packages — `buddy_sealed_packages` with `unsealed_at
 * IS NULL`. Oldest first. SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.6.
 */
export default async function BrokeragePackagesPage() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_sealed_packages")
    .select("id, deal_id, sealed_at, unsealed_at")
    .is("unsealed_at", null)
    .order("sealed_at", { ascending: true })
    .limit(50);

  const pkgs = (data ?? []) as Array<{
    id: string;
    deal_id: string;
    sealed_at: string;
  }>;

  const lastEvents = await loadLastEvents(pkgs.map((p) => p.deal_id));
  const now = new Date().valueOf();

  const rows: StuckRow[] = pkgs.map((p) => {
    const sealed = new Date(p.sealed_at).getTime();
    return {
      id: p.id,
      display_name: p.deal_id.slice(0, 8),
      age_iso: p.sealed_at,
      age_seconds: Math.max(0, Math.floor((now - sealed) / 1000)),
      last_event_action: lastEvents.get(p.deal_id) ?? null,
    };
  });

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      <StuckTable rows={rows} emptyLabel="No active sealed packages." />
    </div>
  );
}
