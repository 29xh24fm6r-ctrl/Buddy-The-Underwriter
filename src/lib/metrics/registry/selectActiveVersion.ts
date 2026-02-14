/**
 * Phase 12/13 — Active Registry Version Selection + Governance
 *
 * Resolves which published registry version is active for V2 computation.
 * "Active" = latest published by published_at (excludes deprecated).
 *
 * Phase 13 additions:
 * - Per-bank registry pinning (resolveRegistryBinding with optional bankId)
 * - Version deprecation (replay-safe — entries never deleted)
 * - listSelectableVersions (published only, excludes deprecated)
 */

import type { RegistryVersion, RegistryEntry, RegistryBinding, BankRegistryPin } from "./types";
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

interface DbPinRow {
  id: string;
  bank_id: string;
  registry_version_id: string;
  pinned_at: string;
  pinned_by: string | null;
  reason: string | null;
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

function rowToPin(row: DbPinRow): BankRegistryPin {
  return {
    id: row.id,
    bankId: row.bank_id,
    registryVersionId: row.registry_version_id,
    pinnedAt: row.pinned_at,
    pinnedBy: row.pinned_by,
    reason: row.reason,
  };
}

// ---------------------------------------------------------------------------
// Select active published version
// ---------------------------------------------------------------------------

/**
 * Fetch the latest published registry version (excludes deprecated).
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
 * List all selectable versions (published only, excludes deprecated + draft).
 */
export async function listSelectableVersions(
  supabase: any,
): Promise<RegistryVersion[]> {
  const { data, error } = await supabase
    .from("metric_registry_versions")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error || !data) return [];
  return (data as DbVersionRow[]).map(rowToVersion);
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
 * NOTE: No status filter — deprecated versions remain loadable (replay-safe).
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
// Per-bank registry pinning (Phase 13)
// ---------------------------------------------------------------------------

/**
 * Load the current bank registry pin, if any.
 */
export async function loadBankPin(
  supabase: any,
  bankId: string,
): Promise<BankRegistryPin | null> {
  const { data, error } = await supabase
    .from("bank_registry_pins")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToPin(data as DbPinRow);
}

// ---------------------------------------------------------------------------
// Resolve binding for compute
// ---------------------------------------------------------------------------

/**
 * Build a RegistryBinding from a RegistryVersion, computing content hash if needed.
 */
async function versionToBinding(
  supabase: any,
  version: RegistryVersion,
): Promise<RegistryBinding> {
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

/**
 * Resolve the registry binding for a V2 compute.
 *
 * Resolution order (Phase 13):
 * 1. If bankId provided AND bank_registry_pins row exists → use pinned version
 *    (even if deprecated — pinning is intentional)
 * 2. Else → latest published (non-deprecated) via selectActiveVersion()
 * 3. If none → return null (never silently default)
 */
export async function resolveRegistryBinding(
  supabase: any,
  bankId?: string,
): Promise<RegistryBinding | null> {
  // Phase 13: Check bank pin first
  if (bankId) {
    const pin = await loadBankPin(supabase, bankId);
    if (pin) {
      const pinnedVersion = await loadVersionById(supabase, pin.registryVersionId);
      if (pinnedVersion) {
        return versionToBinding(supabase, pinnedVersion);
      }
    }
  }

  // Global: latest published (non-deprecated)
  const version = await selectActiveVersion(supabase);
  if (!version) return null;

  return versionToBinding(supabase, version);
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

// ---------------------------------------------------------------------------
// Deprecate a published version (Phase 13)
// ---------------------------------------------------------------------------

/**
 * Deprecate a published registry version.
 *
 * Rules:
 * - Only published → deprecated (CAS guard)
 * - Entries are NEVER deleted (replay-safe)
 * - Deprecated versions are NOT auto-selected for new bindings
 * - Deprecated versions remain loadable via loadVersionEntries()
 */
export async function deprecateVersion(
  supabase: any,
  versionId: string,
): Promise<{ ok: true; version: RegistryVersion } | { ok: false; error: string }> {
  const version = await loadVersionById(supabase, versionId);
  if (!version) return { ok: false, error: "version_not_found" };
  if (version.status === "deprecated") {
    return { ok: false, error: "already_deprecated" };
  }
  if (version.status !== "published") {
    return { ok: false, error: "only_published_can_be_deprecated" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("metric_registry_versions")
    .update({
      status: "deprecated",
      updated_at: now,
    })
    .eq("id", versionId)
    .eq("status", "published") // CAS guard
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "deprecate_failed" };
  }

  return { ok: true, version: rowToVersion(data as DbVersionRow) };
}
