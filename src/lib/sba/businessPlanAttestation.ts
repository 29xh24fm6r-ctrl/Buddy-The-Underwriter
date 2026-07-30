import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — borrower attestation for the AI-generated
 * SBA business plan. Immutable, append-only rows (deal_business_plan_
 * attestations) — same pattern as borrower_owner_attestations
 * (20260127000001_borrower_confidence_attestation.sql): never updated in
 * place, latest row wins.
 *
 * `narrative_snapshot_hash` lets a caller tell whether the plan text has
 * changed since the borrower last attested — the SBA package pipeline has
 * no input-hash/regeneration-guard of its own (sbaPackageOrchestrator.ts
 * regenerates every narrative section fresh on every call, unlike the
 * credit-memo narrative pipeline's exact-hash cache), so a fresh
 * regeneration must show as "not yet attested" rather than silently
 * inheriting a stale confirmation.
 */

import { createHash } from "node:crypto";

type SB = { from: (t: string) => any };

const NARRATIVE_COLUMNS = [
  "business_overview_narrative",
  "executive_summary",
  "industry_analysis",
  "marketing_strategy",
  "operations_plan",
  "swot_strengths",
  "swot_weaknesses",
  "swot_opportunities",
  "swot_threats",
  "sensitivity_narrative",
  "plan_thesis",
] as const;

export type BusinessPlanPackageRow = Record<(typeof NARRATIVE_COLUMNS)[number], string | null> & {
  id: string;
  deal_id: string;
};

export function hashPackageNarratives(pkg: Record<string, unknown>): string {
  const canonical: Record<string, string> = {};
  for (const col of NARRATIVE_COLUMNS) {
    canonical[col] = typeof pkg[col] === "string" ? (pkg[col] as string) : "";
  }
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash("sha256").update(json).digest("hex");
}

export type BusinessPlanAttestationStatus = {
  attested: boolean;
  /** True only when the borrower attested this EXACT narrative content. */
  snapshotMatchesCurrent: boolean;
  attestedAt: string | null;
  attestedByName: string | null;
};

export async function getBusinessPlanAttestationStatus(
  dealId: string,
  currentSnapshotHash: string,
  sb: SB,
): Promise<BusinessPlanAttestationStatus> {
  const { data } = await sb
    .from("deal_business_plan_attestations")
    .select("narrative_snapshot_hash, attested_at, attested_by_name")
    .eq("deal_id", dealId)
    .order("attested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return { attested: false, snapshotMatchesCurrent: false, attestedAt: null, attestedByName: null };
  }

  const snapshotMatchesCurrent = data.narrative_snapshot_hash === currentSnapshotHash;
  return {
    attested: true,
    snapshotMatchesCurrent,
    attestedAt: data.attested_at,
    attestedByName: data.attested_by_name ?? null,
  };
}

export async function recordBusinessPlanAttestation(args: {
  dealId: string;
  bankId: string;
  packageId: string;
  narrativeSnapshotHash: string;
  attestedByName: string | null;
  attestedByEmail: string | null;
  sb: SB;
}): Promise<void> {
  const { dealId, bankId, packageId, narrativeSnapshotHash, attestedByName, attestedByEmail, sb } = args;

  const { error } = await sb.from("deal_business_plan_attestations").insert({
    deal_id: dealId,
    bank_id: bankId,
    package_id: packageId,
    narrative_snapshot_hash: narrativeSnapshotHash,
    attested_by_name: attestedByName,
    attested_by_email: attestedByEmail,
  });

  if (error) {
    throw new Error(`recordBusinessPlanAttestation_failed: ${error.message}`);
  }
}
