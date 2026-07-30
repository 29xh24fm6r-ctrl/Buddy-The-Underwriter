#!/usr/bin/env node
/**
 * CI guard — SPEC-DRIFT-HARDENING-1 D2.
 *
 * The 2026-07-30 reconciliation incident found two migration files sharing
 * the exact same full 14-digit timestamp (20260729000000_ai_gateway_calls.sql
 * and 20260729000000_telemetry_retention.sql) — under Workflow B (see
 * supabase/migrations/README.md), that timestamp IS the version key recorded
 * in Supabase's schema_migrations table, so a collision means only one of
 * the two can ever be the version of record; the other silently never
 * applies via the normal path. This guard fails CI if any two migration
 * files share a full 14-digit timestamp prefix.
 *
 * Scope: only 14-digit (YYYYMMDDHHMMSS) prefixes are checked. The ~150
 * pre-2026-03-25 files use bare 8-digit (YYYYMMDD) date-only prefixes and
 * routinely share a date across many files (see README's documented
 * Workflow A / Workflow B split) — that is expected, historical, and out of
 * scope for this guard.
 */

import { readdirSync } from "node:fs";

const MIGRATIONS_DIR =
  process.env.MIGRATION_VERSIONS_DIR || "supabase/migrations";

let files;
try {
  files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
} catch {
  console.log("✅ guard-migration-versions passed (no migrations directory found).");
  process.exit(0);
}

const byVersion = new Map();
for (const f of files) {
  const m = /^(\d{14})_/.exec(f);
  if (!m) continue;
  const version = m[1];
  if (!byVersion.has(version)) byVersion.set(version, []);
  byVersion.get(version).push(f);
}

const duplicates = [...byVersion.entries()].filter(([, fs]) => fs.length > 1);

if (duplicates.length) {
  console.error(
    "\n❌ Duplicate full-timestamp migration version(s) found (SPEC-DRIFT-HARDENING-1 D2):\n",
  );
  for (const [version, fs] of duplicates) {
    console.error(` - ${version}:`);
    for (const f of fs) console.error(`     ${f}`);
  }
  console.error(
    "\nTwo migrations cannot share a full 14-digit timestamp — Supabase's " +
      "schema_migrations table records exactly one row per version, so only " +
      "one file's DDL is ever the applied version of record for that " +
      "timestamp. Rename the newer file's local timestamp to something " +
      "unique (filename only — never edit the DDL body of an already-merged " +
      "migration; if the file is unmerged, editing it in place is fine).\n",
  );
  process.exit(1);
}

console.log(
  `✅ guard-migration-versions passed (${byVersion.size} distinct full-timestamp version(s), 0 duplicates).`,
);
