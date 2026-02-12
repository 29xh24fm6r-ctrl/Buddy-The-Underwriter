/**
 * Artifact Engine — Loader
 *
 * Reads underwrite artifacts from the database.
 *
 * PHASE 7: DB read only — no mutations, no side effects.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ArtifactRow, ArtifactSummary } from "./types";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): ArtifactRow {
  return {
    id: row.id,
    dealId: row.deal_id,
    bankId: row.bank_id,
    productType: row.product_type,
    version: row.version,
    status: row.status,
    supersedesArtifactId: row.supersedes_artifact_id,

    snapshotJson: row.snapshot_json,
    analysisJson: row.analysis_json,
    policyJson: row.policy_json,
    stressJson: row.stress_json,
    pricingJson: row.pricing_json,
    memoJson: row.memo_json,

    hashes: {
      modelHash: row.model_hash,
      snapshotHash: row.snapshot_hash,
      policyHash: row.policy_hash,
      stressHash: row.stress_hash,
      pricingHash: row.pricing_hash,
      memoHash: row.memo_hash,
      overallHash: row.overall_hash,
    },

    engineVersion: row.engine_version,
    bankConfigVersionId: row.bank_config_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapSummary(row: any): ArtifactSummary {
  const policyJson = row.policy_json as any;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    productType: row.product_type,
    tier: policyJson?.tier ?? "—",
    recommendation: (row.memo_json as any)?.recommendation ?? "—",
    overallHash: row.overall_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the latest (highest version) artifact for a deal.
 */
export async function loadLatestArtifact(
  dealId: string,
): Promise<ArtifactRow | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("underwrite_artifacts")
    .select("*")
    .eq("deal_id", dealId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data);
}

/**
 * Load a specific artifact by ID.
 */
export async function loadArtifactById(
  artifactId: string,
): Promise<ArtifactRow | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("underwrite_artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data);
}

/**
 * Load artifact history for a deal (summaries, newest first).
 */
export async function loadArtifactHistory(
  dealId: string,
): Promise<ArtifactSummary[]> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("underwrite_artifacts")
    .select("id, version, status, product_type, policy_json, memo_json, overall_hash, created_by, created_at")
    .eq("deal_id", dealId)
    .order("version", { ascending: false });

  if (error || !data) return [];
  return data.map(mapSummary);
}
