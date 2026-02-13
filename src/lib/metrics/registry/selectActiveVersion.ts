/**
 * Phase 12 — Active Registry Version Selection
 *
 * Resolves which published registry version is active for V2 computation.
 * "Active" = latest published by published_at.
 *
 * In dev, if no published version exists, falls back to null (callers
 * decide whether to use built-in seed or error).
 */

import type { RegistryVersion, RegistryEntry, RegistryBinding } from "./types";
import { hashRegistry } from "./hash";

// ---------------------------------------------------------------------------
// DB row → domain type mappers
// ---------------------------------------------------------------------------

interface DbVersionRow {
  id: string;
  version_name: string;
  version_number: number;
  content_hash: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

interface DbEntryRow {
  id: string;
  registry_version_id: string;
  metric_key: string;
  definition_json: Record<string, unknown>;
  definition_hash: string | null;
  created_at: string;
}

function rowToVersion(row: DbVersionRow): RegistryVersion {
  return {
    id: row.id,
    versionName: row.version_name,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    status: row.status as RegistryVersion["status"],
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function rowToEntry(row: DbEntryRow): RegistryEntry {
  return {
    id: row.id,
    registryVersionId: row.registry_version_id,
    metricKey: row.metric_key,
    definitionJson: row.definition_json,
    definitionHash: row.definition_hash,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Select active published version
// ---------------------------------------------------------------------------

/**
 * Fetch the latest published registry version.
 * Returns null if no published version exists.
 */
export async function selectActiveVersion(
  supabase: any,
): Promise<RegistryVersion | null> {
  const { data, error } = await supabase
    .from("metric_registry_versions")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToVersion(data as DbVersionRow);
}

/**
 * Load a specific registry version by ID.
 */
export async function loadVersionById(
  supabase: any,
  versionId: string,
): Promise<RegistryVersion | null> {
  const { data, error } = await supabase
    .from("metric_registry_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToVersion(data as DbVersionRow);
}

/**
 * Load all entries for a registry version.
 */
export async function loadVersionEntries(
  supabase: any,
  versionId: string,
): Promise<RegistryEntry[]> {
  const { data, error } = await supabase
    .from("metric_registry_entries")
    .select("*")
    .eq("registry_version_id", versionId)
    .order("metric_key");

  if (error || !data) return [];
  return (data as DbEntryRow[]).map(rowToEntry);
}

// ---------------------------------------------------------------------------
// Resolve binding for compute
// ---------------------------------------------------------------------------

/**
 * Resolve the registry binding for a V2 compute.
 * Returns the active version + content hash, or null if none published.
 */
export async function resolveRegistryBinding(
  supabase: any,
): Promise<RegistryBinding | null> {
  const version = await selectActiveVersion(supabase);
  if (!version) return null;

  // If content_hash was set at publish time, use it
  if (version.contentHash) {
    return {
      registryVersionId: version.id,
      registryVersionName: version.versionName,
      registryContentHash: version.contentHash,
    };
  }

  // Fallback: compute hash from entries (shouldn't happen if publish is correct)
  const entries = await loadVersionEntries(supabase, version.id);
  const contentHash = hashRegistry(entries.map((e) => ({
    metric_key: e.metricKey,
    definition_json: e.definitionJson,
  })));

  return {
    registryVersionId: version.id,
    registryVersionName: version.versionName,
    registryContentHash: contentHash,
  };
}

// ---------------------------------------------------------------------------
// Publish a draft version
// ---------------------------------------------------------------------------

/**
 * Publish a draft registry version.
 * Computes content_hash from entries, sets status=published.
 *
 * Returns the updated version or an error.
 */
export async function publishVersion(
  supabase: any,
  versionId: string,
): Promise<{ ok: true; version: RegistryVersion } | { ok: false; error: string }> {
  // 1. Load version
  const version = await loadVersionById(supabase, versionId);
  if (!version) return { ok: false, error: "version_not_found" };
  if (version.status !== "draft") {
    return { ok: false, error: "REGISTRY_IMMUTABLE" };
  }

  // 2. Load entries + compute hash
  const entries = await loadVersionEntries(supabase, versionId);
  if (entries.length === 0) {
    return { ok: false, error: "no_entries" };
  }

  const contentHash = hashRegistry(entries.map((e) => ({
    metric_key: e.metricKey,
    definition_json: e.definitionJson,
  })));

  // 3. Update version
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("metric_registry_versions")
    .update({
      status: "published",
      content_hash: contentHash,
      published_at: now,
      updated_at: now,
    })
    .eq("id", versionId)
    .eq("status", "draft") // CAS guard
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "publish_failed" };
  }

  return { ok: true, version: rowToVersion(data as DbVersionRow) };
}
