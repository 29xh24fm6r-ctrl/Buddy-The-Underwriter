/**
 * SPEC-FOUNDATION-V1 PR1 — CI guard: principal_bio override key consistency.
 *
 * Invariant: when the legacy migration creates management profiles with
 * new canonical UUIDs, it MUST rewrite the principal_bio_{legacyId}
 * override keys to principal_bio_{canonicalId} in the same transaction.
 * Otherwise the readiness contract (evaluateMemoReadinessContract)
 * checks principal_bio_{canonicalId} but the data lives under the
 * orphaned legacy key.
 *
 * This guard reads source files to assert the rekey logic is present
 * and the telemetry fields are wired into the audit event.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts",
);
const BUILD_INPUT_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/inputs/buildMemoInputPackage.ts",
);

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// ─── Guard 1: migration builds the legacyId → canonicalId map ──────────────

test("[principal-bio-consistency-1] migration captures legacyToCanonicalId map", () => {
  const body = read(MIGRATION_PATH);
  assert.match(
    body,
    /legacyToCanonicalId/,
    "migrateLegacyOverridesAsync must build a legacyToCanonicalId map during management profile upsert loop.",
  );
  assert.match(
    body,
    /legacyToCanonicalId\.set\(/,
    "migrateLegacyOverridesAsync must populate the map with legacyToCanonicalId.set().",
  );
});

// ─── Guard 2: migration rewrites override keys after profiles are created ──

test("[principal-bio-consistency-2] migration rewrites principal_bio_ override keys", () => {
  const body = read(MIGRATION_PATH);
  // The rekey block must reference deal_memo_overrides for the UPDATE
  assert.match(
    body,
    /deal_memo_overrides/,
    "migrateLegacyOverridesAsync must UPDATE deal_memo_overrides with rekeyed overrides.",
  );
  assert.match(
    body,
    /PRINCIPAL_BIO_PREFIX/,
    "migrateLegacyOverridesAsync must use PRINCIPAL_BIO_PREFIX to identify keys to rewrite.",
  );
});

// ─── Guard 3: migration only rekeys UUID-shaped suffixes ────────────────────

test("[principal-bio-consistency-3] migration uses UUID regex to filter rekey candidates", () => {
  const body = read(MIGRATION_PATH);
  assert.match(
    body,
    /UUID_RE/,
    "migrateLegacyOverridesAsync must filter principal_bio_ keys by UUID regex to avoid rekeying non-UUID keys like principal_bio_general.",
  );
});

// ─── Guard 4: return type includes rewriting telemetry ──────────────────────

test("[principal-bio-consistency-4] migration result type includes overrideKeysRewritten", () => {
  const body = read(MIGRATION_PATH);
  assert.match(
    body,
    /overrideKeysRewritten/,
    "MigrateLegacyOverridesResult must include overrideKeysRewritten for telemetry.",
  );
  assert.match(
    body,
    /orphanedOverrideKeys/,
    "MigrateLegacyOverridesResult must include orphanedOverrideKeys for telemetry.",
  );
});

// ─── Guard 5: audit event payload captures rewriting outcome ────────────────

test("[principal-bio-consistency-5] buildMemoInputPackage emits rewriting telemetry in audit event", () => {
  const body = read(BUILD_INPUT_PATH);
  assert.match(
    body,
    /override_keys_rewritten/,
    "memo_input.legacy_migration audit event must include override_keys_rewritten.",
  );
  assert.match(
    body,
    /orphaned_override_keys/,
    "memo_input.legacy_migration audit event must include orphaned_override_keys.",
  );
});

// ─── Guard 6: backfill script exists ────────────────────────────────────────

test("[principal-bio-consistency-6] backfill script exists at expected path", () => {
  const SCRIPT_PATH = join(
    REPO_ROOT,
    "scripts/foundation-pr1-rekey-principal-bios.ts",
  );
  let exists = false;
  try {
    readFileSync(SCRIPT_PATH, "utf8");
    exists = true;
  } catch {
    // File doesn't exist
  }
  assert.ok(
    exists,
    "scripts/foundation-pr1-rekey-principal-bios.ts must exist for one-shot backfill of already-migrated deals.",
  );
});

// ─── Guard 7: backfill script is idempotent ─────────────────────────────────

test("[principal-bio-consistency-7] backfill script supports --dry-run and --execute modes", () => {
  const SCRIPT_PATH = join(
    REPO_ROOT,
    "scripts/foundation-pr1-rekey-principal-bios.ts",
  );
  const body = readFileSync(SCRIPT_PATH, "utf8");
  assert.match(body, /--dry-run/, "Script must support --dry-run mode.");
  assert.match(body, /--execute/, "Script must support --execute mode.");
  assert.match(
    body,
    /idempotent/i,
    "Script source must document idempotency (re-running on already-rekeyed deals is a no-op).",
  );
});

// ─── Guard 8: backfill script uses UUID regex to avoid rekeying non-UUID keys ─

test("[principal-bio-consistency-8] backfill script filters by UUID regex", () => {
  const SCRIPT_PATH = join(
    REPO_ROOT,
    "scripts/foundation-pr1-rekey-principal-bios.ts",
  );
  const body = readFileSync(SCRIPT_PATH, "utf8");
  assert.match(
    body,
    /UUID_RE|[0-9a-f]\{8\}-[0-9a-f]\{4\}/,
    "Backfill script must use a UUID regex to filter principal_bio_ keys, avoiding non-UUID keys like principal_bio_general.",
  );
});
