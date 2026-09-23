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

/**
 * The snapshot schema this build produces and can verify.
 *
 * hashTridentManifest hashes a DIFFERENT DOMAIN depending on this number:
 * v5/v6/v7 digest only `sources`, earlier shapes digest the whole manifest. So a
 * hash produced by one schema generation is not comparable to one produced by
 * another — not "different", incomparable.
 *
 * That matters because admission and verification happen in different
 * invocations. Production carried six schema generations in twelve days
 * (unversioned, 2, 3, 4, 5, 6); when a deploy landed between a run's admission
 * and its first workflow step, the step recomputed the digest under the new
 * schema, compared it against a hash the old schema produced, and could never
 * match. The run then died as `input_snapshot_changed` — after three pointless
 * retries — telling the operator the borrower had edited the deal. Nobody had.
 * Five production runs failed exactly this way, and none of them carried a
 * `changed_sources` list, because there was no source drift to report.
 */
export const TRIDENT_SNAPSHOT_VERSION = 11;

/** Keep evidence dates, but ignore the aggregator's wall-clock persistence date.
 * runCashFlowAggregator stamps this specific provenance on every recomputation,
 * including reads through the spread renderer. It is not the reporting period.
 * Keep the full original provenance in the stored manifest for audit purposes.
 */
function comparableSources(sources: JsonRecord, version: number): JsonRecord {
  // V11 excludes only this deal-level scheduler cursor. Preserve the original
  // manifest and historical hash semantics; do not drop similarly named
  // borrower/document fields or lifecycle decisions that affect release.
  if (version >= 11 && sources.deal && typeof sources.deal === "object") {
    sources = { ...sources, deal: Object.fromEntries(Object.entries(sources.deal)
      .filter(([key]) => key !== "brokerage_comms_last_run_at")) };
  }
  if (!Array.isArray(sources.financialFacts)) return sources;
  return {
    ...sources,
    financialFacts: sources.financialFacts.map((fact: JsonRecord) => {
      const provenance = fact?.provenance as JsonRecord | undefined;
      if (provenance?.source_type !== "STRUCTURAL" ||
          provenance.source_ref !== "computed:classic_spread:v2" ||
          provenance.extractor !== "runCashFlowAggregator:v2") return fact;
      return {
        ...fact,
        provenance: Object.fromEntries(Object.entries(provenance).filter(([key]) => key !== "as_of_date")),
      };
    }),
  };
}

/** A schema-generation change, not borrower drift. Callers must not retry. */
export class TridentSnapshotSchemaChanged extends Error {
  readonly admittedVersion: unknown;
  readonly currentVersion: number;
  constructor(admittedVersion: unknown) {
    super(
      `snapshot_schema_superseded: admitted under snapshot schema v${String(admittedVersion ?? "unversioned")}, ` +
        `this build produces v${TRIDENT_SNAPSHOT_VERSION}. The borrower's inputs did not change; ` +
        `a deploy replaced the snapshot schema mid-run. Start a new run.`,
    );
    this.name = "TridentSnapshotSchemaChanged";
    this.admittedVersion = admittedVersion;
    this.currentVersion = TRIDENT_SNAPSHOT_VERSION;
  }
}

export function hashTridentManifest(manifest: Record<string, unknown>): string {
  // V6 separates borrower/underwriting inputs from asynchronously governed
  // evidence and factory-produced derivatives. Research remains in the audit
  // manifest and is enforced by readiness/release, but its lifecycle workers
  // may not invalidate the factory's own frozen borrower snapshot.
  const hashDomain =
    (manifest.version === 5 || manifest.version === 6 || manifest.version === 7 || manifest.version === 8 || manifest.version === 9 || manifest.version === 10 || manifest.version === 11) &&
      manifest.sources && typeof manifest.sources === "object"
      ? manifest.sources
      : manifest;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(semanticTridentSnapshot(
      Number(manifest.version) >= 9 ? comparableSources(hashDomain as JsonRecord, Number(manifest.version)) : hashDomain,
    ))))
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
    packageInterview,
    personalFinancialSchedules,
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
    requiredRows(sb, "borrower_concierge_sessions", dealId).then(rows => rows.map((row: any) => Object.fromEntries(
      ["package_answers", "guided_answers"].map(key => [key, Object.fromEntries(Object.entries(row.confirmed_facts?.[key] ?? {}).map(([id, answer]) => [id, (answer as any)?.value ?? null]))]),
    ))),
    Promise.all(["borrower_pfs_notes_payable", "borrower_pfs_securities", "borrower_pfs_real_estate"].map(async table => [table, await requiredRows(sb, table, dealId)])).then(Object.fromEntries),
    requiredRows(sb, "deal_documents", dealId),
    requiredRows(sb, "deal_proceeds_items", dealId),
    requiredRows(sb, "borrower_applications", dealId),
    requiredRows(sb, "buddy_validation_reports", dealId),
    requiredRows(sb, "buddy_research_missions", dealId),
  ]);
  if (dealResult.error || !dealResult.data) {
    throw new Error(`trident_snapshot_read_failed:deals:${dealResult.error?.message ?? "missing"}`);
  }

  const formOwners = await requiredRows(sb, "ownership_entities", dealId) as Array<{ id: string }>;
  const formOwnerIds = formOwners.map(owner => owner.id);
  const [borrower, loanRequests, pfs, protectedIdentifiers] = await Promise.all([
    dealResult.data.borrower_id ? sb.from("borrowers").select("*").eq("id", dealResult.data.borrower_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    requiredRows(sb, "deal_loan_requests", dealId),
    formOwnerIds.length ? sb.from("borrower_applicant_financials").select("*").in("applicant_id", formOwnerIds) : Promise.resolve({ data: [], error: null }),
    sb.from("deal_pii_records").select("id,ownership_entity_id,pii_type,updated_at").eq("deal_id", dealId),
  ]);
  if (borrower.error || pfs.error || protectedIdentifiers.error) throw new Error("trident_snapshot_read_failed:form_inputs");
  // Track protected-input revisions without copying SSNs or encrypted payloads.
  const identifierRevisions = (protectedIdentifiers.data ?? []).map((record: any) => ({ id: record.id, ownerId: record.ownership_entity_id, type: record.pii_type, revision: record.updated_at }));
  const formInputs = { borrower: borrower.data, owners: formOwners, loanRequests, pfs: pfs.data, identifierRevisions };
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

  const financialDependencies = Object.fromEntries(await Promise.all([
    "buddy_guarantor_cashflow", "deal_ownership_entities", "deal_ownership_interests",
    "deal_management_profiles", "deal_methodology_choices", "deal_existing_debt_schedule",
  ].map(async table => [table, await requiredRows(sb, table, dealId)])));
  const manifest = canonicalize({
    version: TRIDENT_SNAPSHOT_VERSION,
    // Freeze only borrower and underwriting source-of-truth rows. Governed
    // research is retained below for provenance and independently required by
    // readiness/release, while asynchronous lifecycle convergence cannot make
    // an admitted factory invalidate itself.
    sources: {
      packageFormat: "complete-lender-package-v3",
      financialDependencies,
      formInputs,
      deal: dealResult.data,
      pricingDecisions,
      financialFacts,
      structuralPricing,
      assumptions,
      borrowerStories,
      packageInterview,
      personalFinancialSchedules,
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
  // Missing evidence cannot establish that every category changed.
  if (!admittedManifest?.sources) return [];
  const admittedSources = comparableSources(
    admittedManifest?.sources && typeof admittedManifest.sources === "object"
      ? admittedManifest.sources as JsonRecord
      : {}, Number(admittedManifest.version));
  const currentSources = comparableSources(
    currentManifest.sources && typeof currentManifest.sources === "object"
      ? currentManifest.sources as JsonRecord
      : {}, Number(currentManifest.version));
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
  expectedManifest: Record<string, unknown> | null;
}): Promise<void> {
  // Schema generation first. A hash mismatch across schema versions says
  // nothing about the borrower's data, and reporting it as input drift sends
  // whoever is debugging to look for an edit that never happened.
  if (args.expectedManifest) {
    const admittedVersion = (args.expectedManifest as JsonRecord).version;
    if (admittedVersion !== TRIDENT_SNAPSHOT_VERSION) {
      throw new TridentSnapshotSchemaChanged(admittedVersion);
    }
  }
  if (!args.expectedManifest?.sources) {
    throw new Error("snapshot_manifest_unavailable: the admitted input evidence could not be verified");
  }

  const current = await computeTridentInputSnapshot(args.sb, args.dealId);
  if (current.inputHash !== args.expectedHash) {
    const changedSources = summarizeTridentSourceDrift(args.expectedManifest, current.manifest);
    throw new Error(
      `input_snapshot_changed: admitted=${args.expectedHash} current=${current.inputHash}` +
        (changedSources.length > 0
          ? ` changed_sources=${changedSources.join(",")}`
          : " changed_sources=(none identified — if this persists with no drift listed," +
            " suspect a non-semantic field leaking into the hashed domain)"),
    );
  }
}
