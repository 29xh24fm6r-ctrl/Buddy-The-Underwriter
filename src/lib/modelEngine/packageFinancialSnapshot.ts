import "server-only";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deterministicHash } from "./hashing";
import { computePackageFinancialOutput, type PackageFinancialOutput } from "./packageFinancialComputation";
import { computeTridentInputSnapshot } from "@/lib/brokerage/trident/tridentInputSnapshot";

export const PACKAGE_FINANCIAL_VERSION = "model_v2_package_2";
export type PackageFinancialSnapshot = { id: string; dealId: string; bankId: string; inputHash: string; outputHash: string; output: PackageFinancialOutput & { canonicalMemo: CanonicalCreditMemoV1; memoContractBlockers: string[] } };

function decode(row: any): PackageFinancialSnapshot {
  if (!row?.package_output || row.model_version !== PACKAGE_FINANCIAL_VERSION ||
      deterministicHash(row.package_output) !== row.outputs_hash) {
    throw new Error("financial_snapshot_invalid: saved package financials failed integrity verification");
  }
  return { id: row.id, dealId: row.deal_id, bankId: row.bank_id, inputHash: row.package_input_hash,
    outputHash: row.outputs_hash, output: row.package_output };
}

export async function loadPackageFinancialSnapshot(args: { dealId: string; bankId?: string; snapshotId: string }) {
  let query = supabaseAdmin().from("deal_model_snapshots").select("*")
    .eq("id", args.snapshotId).eq("deal_id", args.dealId);
  if (args.bankId) query = query.eq("bank_id", args.bankId);
  const { data, error } = await query.single();
  if (error || !data) throw new Error(`financial_snapshot_missing: ${error?.message ?? args.snapshotId}`);
  return decode(data);
}

/** Compute once, persist before any writer runs, then read the persisted row back. */
export async function preparePackageFinancialSnapshot(args: { dealId: string; bankId?: string; inputHash?: string }): Promise<PackageFinancialSnapshot> {
  const sb = supabaseAdmin();
  const { data: deal, error: dealError } = await sb.from("deals").select("bank_id").eq("id", args.dealId).single();
  if (dealError || !deal?.bank_id || (args.bankId && args.bankId !== deal.bank_id)) throw new Error("financial_snapshot_deal_mismatch");
  const bankId = String(deal.bank_id);
  const before = await computeTridentInputSnapshot(sb, args.dealId);
  if (args.inputHash && args.inputHash !== before.inputHash) throw new Error("input_snapshot_changed");
  const inputHash = deterministicHash({ inputHash: before.inputHash, version: PACKAGE_FINANCIAL_VERSION });
  const find = () => sb.from("deal_model_snapshots").select("*").eq("deal_id", args.dealId)
    .eq("bank_id", bankId).eq("package_input_hash", inputHash).maybeSingle();
  const existing = await find();
  if (existing.error) throw existing.error;
  if (existing.data) return decode(existing.data);
  const computed = await computePackageFinancialOutput(args.dealId, bankId);
  if (!computed.ok) throw new Error(`financial_input_required: ${computed.error}`);
  const memo = await buildCanonicalCreditMemo({ dealId: args.dealId, bankId, executionContext: "system", financialOutput: computed.output });
  if (!memo.ok) throw new Error(`financial_input_required: ${memo.error}`);
  const after = await computeTridentInputSnapshot(sb, args.dealId);
  if (after.inputHash !== before.inputHash) throw new Error("input_snapshot_changed");
  // JSON normalization is part of persistence; integrity hashes exactly those bytes/values.
  const output = JSON.parse(JSON.stringify({ ...computed.output, canonicalMemo: memo.memo, memoContractBlockers: memo.contractBlockers })) as PackageFinancialSnapshot["output"];
  const outputHash = deterministicHash(output);
  const { data, error } = await sb.from("deal_model_snapshots").insert({
    deal_id: args.dealId, bank_id: bankId, model_version: PACKAGE_FINANCIAL_VERSION,
    metric_registry_hash: deterministicHash(output.computedMetrics),
    financial_model_hash: deterministicHash(output.historicalModel),
    computed_metrics: output.computedMetrics, risk_flags: output.riskFlags, quality_flags: [],
    calculated_at: new Date().toISOString(), package_input_hash: inputHash,
    package_output: output, outputs_hash: outputHash, engine_version: PACKAGE_FINANCIAL_VERSION,
  }).select("*").single();
  if (error?.code === "23505") {
    const raced = await find();
    if (raced.error || !raced.data) throw raced.error ?? error;
    return decode(raced.data);
  }
  if (error || !data) throw new Error(`financial_snapshot_save_failed: ${error?.message ?? "missing row"}`);
  return decode(data);
}
