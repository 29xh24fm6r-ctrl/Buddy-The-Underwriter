import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getPolicySnapshot } from "@/lib/policy/snapshot";

function diffKeys(a: any, b: any) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const k of keys) {
    const av = JSON.stringify(a?.[k] ?? null);
    const bv = JSON.stringify(b?.[k] ?? null);
    if (av !== bv) changed.push(k);
  }
  return changed.sort();
}

export async function GET(_req: Request, ctx: { params: Promise<{ dealId: string; snapshotId: string }> }) {
  const { dealId, snapshotId } = await ctx.params;
  await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: snap, error } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .eq("id", snapshotId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // Current inputs: if you have a canonical "deals" or "deal_inputs" table, wire it here.
  // Safe fallback: empty.
  let currentInputs: any = {};
  for (const t of ["deal_inputs", "deals"]) {
    const r = await sb.from(t as any).select("*").eq("id", dealId).maybeSingle();
    if (!r.error && r.data) { currentInputs = r.data; break; }
  }

  const { data: deal } = await sb.from("deals").select("bank_id").eq("id", dealId).single();
  const currentPolicy = deal?.bank_id ? await getPolicySnapshot(deal.bank_id).catch(() => []) : [];

  return NextResponse.json({
    snapshot: snap,
    current: {
      inputs_json: currentInputs,
      policy_snapshot_json: currentPolicy,
    },
    diff: {
      inputs_changed_keys: diffKeys(snap.inputs_json, currentInputs),
      policy_changed: JSON.stringify(snap.policy_snapshot_json) !== JSON.stringify(currentPolicy),
    },
  });
}
