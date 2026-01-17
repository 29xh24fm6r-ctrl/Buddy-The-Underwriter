import "server-only";

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(",")}}`;
}

export function hashSnapshot(snapshot: DealFinancialSnapshotV1): string {
  const stable = stableStringify(snapshot);
  return createHash("sha256").update(stable).digest("hex");
}

export async function persistFinancialSnapshot(args: {
  dealId: string;
  bankId: string;
  snapshot: DealFinancialSnapshotV1;
  derivedFromEventId?: string | null;
  asOfTimestamp?: string | null;
}) {
  const sb = supabaseAdmin();
  const snapshotHash = hashSnapshot(args.snapshot);

  const { data, error } = await sb
    .from("financial_snapshots")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      as_of_timestamp: args.asOfTimestamp ?? new Date().toISOString(),
      snapshot_hash: snapshotHash,
      derived_from_event_id: args.derivedFromEventId ?? null,
      snapshot_json: args.snapshot as any,
    })
    .select("id, deal_id, bank_id, as_of_timestamp, snapshot_hash, created_at")
    .single();

  if (error) throw error;
  return data as {
    id: string;
    deal_id: string;
    bank_id: string;
    as_of_timestamp: string;
    snapshot_hash: string;
    created_at: string;
  };
}

export async function persistFinancialSnapshotDecision(args: {
  snapshotId: string;
  dealId: string;
  bankId: string;
  inputs: Record<string, any>;
  stress: Record<string, any>;
  sba: Record<string, any>;
  narrative: Record<string, any>;
}) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("financial_snapshot_decisions")
    .insert({
      financial_snapshot_id: args.snapshotId,
      deal_id: args.dealId,
      bank_id: args.bankId,
      inputs_json: args.inputs,
      stress_json: args.stress,
      sba_json: args.sba,
      narrative_json: args.narrative,
    })
    .select("id, financial_snapshot_id, deal_id, bank_id, created_at")
    .single();

  if (error) throw error;
  return data as {
    id: string;
    financial_snapshot_id: string;
    deal_id: string;
    bank_id: string;
    created_at: string;
  };
}
