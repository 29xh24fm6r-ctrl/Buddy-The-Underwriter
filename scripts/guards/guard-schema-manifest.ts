#!/usr/bin/env -S tsx
/**
 * CI guard — SPEC-DRIFT-HARDENING-1 D3.
 *
 * Fails CI if any migration >= scripts/audit/schema-manifest.ts's
 * CUTOFF_VERSION creates a table, column, view, or function with no
 * corresponding entry in scripts/audit/schema-manifest.json. Purely static
 * (parses local migration files only, no DB connection) — see
 * scripts/audit/schema-manifest.ts's header comment for how this
 * complements the existing live-DB drift detector (gate:schema-drift)
 * rather than duplicating it.
 *
 * Note: this guard is a .ts file run via `tsx` (like the existing
 * gate:schema-drift / drift-detect.ts), not a plain .mjs — it imports
 * schema-manifest.ts's typed parser directly rather than re-implementing
 * the regex a second time.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CUTOFF_VERSION,
  extractCreatedObjects,
  isRegistered,
  loadManifest,
} from "../audit/schema-manifest";

const MIGRATIONS_DIR =
  process.env.SCHEMA_MANIFEST_MIGRATIONS_DIR || "supabase/migrations";
const MANIFEST_PATH = process.env.SCHEMA_MANIFEST_PATH;

let files: string[];
try {
  files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => /^\d{14}_/.test(f) && f.slice(0, 14) >= CUTOFF_VERSION)
    .sort();
} catch {
  console.log("✅ guard-schema-manifest passed (no migrations directory found).");
  process.exit(0);
}

const manifest = MANIFEST_PATH ? loadManifest(MANIFEST_PATH) : loadManifest();

const missing: { migration: string; name: string; type: string }[] = [];
for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  for (const obj of extractCreatedObjects(sql)) {
    if (!isRegistered(obj, file, manifest)) {
      missing.push({ migration: file, name: obj.name, type: obj.type });
    }
  }
}

if (missing.length) {
  console.error(
    "\n❌ Migration(s) create objects with no schema-manifest.json entry (SPEC-DRIFT-HARDENING-1 D3):\n",
  );
  for (const m of missing) {
    console.error(` - ${m.migration}: ${m.type} "${m.name}"`);
  }
  console.error(
    "\nAdd an entry to scripts/audit/schema-manifest.json for each object above " +
      "(name, type, migration filename) — this is the same manifest the admin " +
      "launch-readiness page's Schema Parity panel checks against at runtime.\n",
  );
  process.exit(1);
}

console.log(
  `✅ guard-schema-manifest passed (${files.length} migration(s) >= ${CUTOFF_VERSION} checked, ${manifest.length} manifest entries, 0 missing).`,
);
