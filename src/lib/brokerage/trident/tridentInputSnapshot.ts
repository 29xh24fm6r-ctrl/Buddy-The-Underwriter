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

/**
 * Byte-order comparison, deliberately NOT localeCompare.
 *
 * localeCompare consults a collation table chosen from the runtime's default
 * locale, and different locales order the same strings differently — sv-SE
 * sorts "ä" after "z" where en-US sorts it after "a". This function decides
 * the byte layout that gets hashed into the admission digest. Admission
 * computes that digest in a request; assertTridentInputSnapshot recomputes it
 * inside the workflow's steps, nine times over a run, in different
 * invocations. If any two of those resolved different default locales, the
 * digests would diverge on identical data and the run would die with
 * `input_snapshot_changed` — which runArtifactFactory classifies as
 * permanent, so it would not retry, and the message would blame the borrower
 * for an edit that never happened (audit F-19).
 *
 * Codepoint order is the same everywhere. A content hash has no business
 * asking what language the machine is set to.
 */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => byCodepoint(JSON.stringify(a), JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => byCodepoint(a, b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashTridentManifest(manifest: Record<string, unknown>): string {
  // V6 separates borrower/underwriting inputs from asynchronously governed
  // evidence and factory-produced derivatives. Research remains in the audit
  // manifest and is enforced by readiness/release, but its lifecycle workers
  // may not invalidate the factory's own frozen borrower snapshot.
  const hashDomain =
    (manifest.version === 5 || manifest.version === 6) &&
      manifest.sources && typeof manifest.sources === "object"
      ? manifest.sources
      : manifest;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(semanticTridentSnapshot(hashDomain))))
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
    version: 6,
    // Freeze only borrower and underwriting source-of-truth rows. Governed
    // research is retained below for provenance and independently required by
    // readiness/release, while asynchronous lifecycle convergence cannot make
    // an admitted factory invalidate itself.
    sources: {
      deal: dealResult.data,
      pricingDecisions,
      financialFacts,
      structuralPricing,
      assumptions,
      borrowerStories,
      documents,
      proceeds,
      applications,
    },
    governedEvidenceAtAdmission: {
      researchMissions,
      researchSources,
      researchFacts,
      researchInferences,
      researchNarratives,
      researchQualityGates,
    },
    derivedAtAdmission: {
      financialSnapshots,
      validationReports,
      memoInputHash,
    },
  }) as Record<string, unknown>;

  return { inputHash: hashTridentManifest(manifest), memoInputHash, manifest };
}

export async function computeTridentInputHash(
  sb: SupabaseClient,
  dealId: string,
): Promise<string> {
  return (await computeTridentInputSnapshot(sb, dealId)).inputHash;
}

export function summarizeTridentSourceDrift(
  admittedManifest: Record<string, unknown> | null | undefined,
  currentManifest: Record<string, unknown>,
): string[] {
  const admittedSources =
    admittedManifest?.sources && typeof admittedManifest.sources === "object"
      ? admittedManifest.sources as JsonRecord
      : {};
  const currentSources =
    currentManifest.sources && typeof currentManifest.sources === "object"
      ? currentManifest.sources as JsonRecord
      : {};
  return [...new Set([...Object.keys(admittedSources), ...Object.keys(currentSources)])]
    .sort()
    .filter((key) =>
      JSON.stringify(canonicalize(semanticTridentSnapshot(admittedSources[key]))) !==
      JSON.stringify(canonicalize(semanticTridentSnapshot(currentSources[key]))),
    );
}

export async function assertTridentInputSnapshot(args: {
  sb: SupabaseClient;
  dealId: string;
  expectedHash: string;
  expectedManifest?: Record<string, unknown> | null;
}): Promise<void> {
  const current = await computeTridentInputSnapshot(args.sb, args.dealId);
  if (current.inputHash !== args.expectedHash) {
    const changedSources = summarizeTridentSourceDrift(args.expectedManifest, current.manifest);
    throw new Error(
      `input_snapshot_changed: admitted=${args.expectedHash} current=${current.inputHash}` +
        (changedSources.length > 0 ? ` changed_sources=${changedSources.join(",")}` : ""),
    );
  }
}
