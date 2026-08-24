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

// Lifecycle metadata changes while workers heartbeat, checkpoint, validate,
// and publish. Hashing these fields made the factory invalidate its own
// admission even when every substantive underwriting value was unchanged.
// Actual value edits remain in the digest; only non-semantic runtime metadata
// is removed.
export const TRIDENT_VOLATILE_SNAPSHOT_KEYS = new Set([
  "created_at",
  "updated_at",
  "generated_at",
  "started_at",
  "completed_at",
  "last_heartbeat_at",
  "generation_started_at",
  "generation_completed_at",
  "lease_expires_at",
  "intake_processing_queued_at",
  "intake_processing_started_at",
  "intake_processing_last_heartbeat_at",
  "lender_package_generated_at",
  "brokerage_stage_entered_at",
]);

export function semanticTridentSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticTridentSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([key]) => !TRIDENT_VOLATILE_SNAPSHOT_KEYS.has(key))
        .map(([key, child]) => [key, semanticTridentSnapshot(child)]),
    );
  }
  return value;
}

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
    .update(JSON.stringify(canonicalize(semanticTridentSnapshot(manifest))))
    .digest("hex");
}

async function requiredRows(
  sb: SupabaseClient,
  table: string,
  dealId: string,
): Promise<unknown[]> {
  const { data, error } = await sb.from(table).select("*").eq("deal_id", dealId);
  if (error) throw new Error(`trident_snapshot_read_failed:${table}:${error.message}`);
  return data ?? [];
}

async function requiredMissionRows(
  sb: SupabaseClient,
  table: string,
  missionIds: string[],
): Promise<unknown[]> {
  if (missionIds.length === 0) return [];
  const { data, error } = await sb.from(table).select("*").in("mission_id", missionIds);
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
    requiredRows(sb, "buddy_borrower_stories", dealId),
    requiredRows(sb, "deal_documents", dealId),
    requiredRows(sb, "deal_proceeds_items", dealId),
    requiredRows(sb, "borrower_applications", dealId),
    requiredRows(sb, "buddy_validation_reports", dealId),
    requiredRows(sb, "buddy_research_missions", dealId),
  ]);
  if (dealResult.error || !dealResult.data) {
    throw new Error(`trident_snapshot_read_failed:deals:${dealResult.error?.message ?? "missing"}`);
  }

  const missionIds = (researchMissions as Array<{ id?: unknown }>)
    .map((mission) => mission.id)
    .filter((id): id is string => typeof id === "string");
  const [
    researchSources,
    researchFacts,
    researchInferences,
    researchNarratives,
    researchQualityGates,
  ] = await Promise.all([
    requiredMissionRows(sb, "buddy_research_sources", missionIds),
    requiredMissionRows(sb, "buddy_research_facts", missionIds),
    requiredMissionRows(sb, "buddy_research_inferences", missionIds),
    requiredMissionRows(sb, "buddy_research_narratives", missionIds),
    requiredMissionRows(sb, "buddy_research_quality_gates", missionIds),
  ]);

  const manifest = canonicalize({
    version: 4,
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
    researchSources,
    researchFacts,
    researchInferences,
    researchNarratives,
    researchQualityGates,
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
