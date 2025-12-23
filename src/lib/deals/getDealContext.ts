import { supabaseServer } from "@/lib/supabase/server";

export type DealContext = Record<string, any>;

export async function getDealContext(dealId: string): Promise<DealContext> {
  const sb = supabaseServer();

  // 1) Snapshot first
  const snap = await sb
    .from("deal_context_snapshots")
    .select("context, version, updated_at")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!snap.error && snap.data?.context) {
    return {
      ...snap.data.context,
      _meta: { source: "snapshot", version: snap.data.version, updated_at: snap.data.updated_at },
    };
  }

  // 2) Fallback to view
  const view = await sb
    .from("deal_context_v3")
    .select("*")
    .eq("deal_id", dealId)
    .single();

  if (view.error) throw new Error(view.error.message);

  return { ...view.data, _meta: { source: "view_fallback" } };
}
