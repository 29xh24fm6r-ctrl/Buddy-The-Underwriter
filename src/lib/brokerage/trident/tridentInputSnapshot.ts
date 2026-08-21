import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMemoHashInputs } from "@/lib/creditMemo/canonical/fetchMemoHashInputs";
import { computeMemoInputHash } from "@/lib/creditMemo/canonical/memoProvenance";

type JsonRecord = Record<string, unknown>;

export type TridentInputSnapshot = {
  inputHash: string;
  memoInputHash: string;
  manifest: Record<string, unknown>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashTridentManifest(manifest: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(manifest)))
    .digest("hex");
}

async function requiredRows(
  sb: SupabaseClient,
  table: string,
  dealId: string,
): Promise<unknown[]> {
  const { data, error } = await sb
    .from(table)
    .select("*")
    .eq("deal_id", dealId);
  if (error) throw new Error(`trident_snapshot_read_failed:${table}:${error.message}`);
  return data ?? [];
}

export async function computeTridentInputSnapshot(
  sb: SupabaseClient,
  dealId: string,
): Promise<TridentInputSnapshot> {
  const memoInputs = await fetchMemoHashInputs(sb, dealId);
  const memoInputHash = computeMemoInputHash(memoInputs);

  const [
    dealResult,
    financialSnapshots,
    pricingDecisions,
    financialFacts,
    structuralPricing,
    assumptions,
    borrowerStories,
    documents,
    proceeds,
    applications,
    validationReports,
    researchMissions,
  ] = await Promise.all([
    sb.from("deals").select("*").eq("id", dealId).single(),
    requiredRows(sb, "financial_snapshots", dealId),
    requiredRows(sb, "pricing_decisions", dealId),
    requiredRows(sb, "deal_financial_facts", dealId),
    requiredRows(sb, "deal_structural_pricing", dealId),
    requiredRows(sb, "buddy_sba_assumptions", dealId),
    requiredRows(sb, "deal_borrower_story", dealId),
    requiredRows(sb, "deal_documents", dealId),
    requiredRows(sb, "deal_proceeds_items", dealId),
    requiredRows(sb, "borrower_applications", dealId),
    requiredRows(sb, "buddy_validation_reports", dealId),
    requiredRows(sb, "buddy_research_missions", dealId),
  ]);
  if (dealResult.error || !dealResult.data) {
    throw new Error(`trident_snapshot_read_failed:deals:${dealResult.error?.message ?? "missing"}`);
  }

  // The manifest deliberately contains source values, not only row counts or
  // timestamps. Volatile factory outputs are excluded so the factory cannot
  // invalidate its own lease while it is producing artifacts.
  const manifest = canonicalize({
    version: 2,
    deal: dealResult.data,
    financialSnapshots,
    pricingDecisions,
    financialFacts,
    structuralPricing,
    assumptions,
    borrowerStories,
    documents,
    proceeds,
    applications,
    validationReports,
    researchMissions,
    memoInputHash,
  }) as Record<string, unknown>;

  return { inputHash: hashTridentManifest(manifest), memoInputHash, manifest };
}

export async function computeTridentInputHash(
  sb: SupabaseClient,
  dealId: string,
): Promise<string> {
  return (await computeTridentInputSnapshot(sb, dealId)).inputHash;
}

export async function assertTridentInputSnapshot(args: {
  sb: SupabaseClient;
  dealId: string;
  expectedHash: string;
}): Promise<void> {
  const currentHash = await computeTridentInputHash(args.sb, args.dealId);
  if (currentHash !== args.expectedHash) {
    throw new Error(
      `input_snapshot_changed: admitted=${args.expectedHash} current=${currentHash}`,
    );
  }
}
