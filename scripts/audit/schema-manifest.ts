/**
 * Schema manifest (SPEC-DRIFT-HARDENING-1 D3).
 *
 * A hand-maintained, PR-reviewed catalog of every table/column/view/function
 * created by a migration at or after CUTOFF_VERSION. Complements the
 * existing live-DB schema-drift detector (scripts/schema/drift-detect.ts,
 * `gate:schema-drift`) rather than replacing it: that tool answers "does
 * live production actually have what migration history claims" (needs a
 * `DRIFT_DETECT_DB_URL` secret, Phase 1 report-only); this one answers "did
 * the migration's author remember to register what they just created" —
 * fully static, no DB connection, safe to run in guard:all on every commit.
 *
 * scripts/guards/guard-schema-manifest.ts (run via tsx, wired into
 * guard:all) parses every migration >= CUTOFF_VERSION with
 * extractCreatedObjects and fails CI if any created object has no
 * corresponding entry in schema-manifest.json for that exact migration
 * file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CUTOFF_VERSION = "20260729000000";

export type ObjectKind = "table" | "column" | "view" | "function";

export type ManifestEntry = {
  name: string;
  type: ObjectKind;
  migration: string;
};

export type CreatedObject = {
  name: string;
  type: ObjectKind;
};

const MANIFEST_PATH = join(__dirname, "schema-manifest.json");

export function loadManifest(path: string = MANIFEST_PATH): ManifestEntry[] {
  const text = readFileSync(path, "utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON array`);
  }
  return parsed as ManifestEntry[];
}

/**
 * Parses raw migration SQL text for objects it creates. Conservative by
 * design (same philosophy as drift-detect.ts): false negatives (an object
 * this parser fails to notice) are an accepted trade-off; false positives
 * (flagging a migration as missing a manifest entry it doesn't actually
 * need) are not, since that would block CI on a phantom finding.
 */
export function extractCreatedObjects(sql: string): CreatedObject[] {
  const out: CreatedObject[] = [];

  // CREATE TABLE [IF NOT EXISTS] [schema.]name (
  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?(\w+)\s*\(/gi,
  )) {
    out.push({ name: m[1], type: "table" });
  }

  // ALTER TABLE [IF EXISTS] [schema.]name <body-up-to-first-semicolon> —
  // captured as a block so multiple ADD COLUMN clauses in one statement
  // (e.g. two columns added in a single ALTER TABLE) are all found.
  for (const alterMatch of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:\w+\.)?(\w+)\s+([\s\S]*?);/gi,
  )) {
    const table = alterMatch[1];
    const body = alterMatch[2];
    for (const colM of body.matchAll(
      /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\b/gi,
    )) {
      out.push({ name: `${table}.${colM[1]}`, type: "column" });
    }
  }

  // CREATE [OR REPLACE] VIEW [schema.]name AS
  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?view\s+(?:\w+\.)?(\w+)\s+as\b/gi,
  )) {
    out.push({ name: m[1], type: "view" });
  }

  // CREATE [OR REPLACE] FUNCTION [schema.]name(
  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:\w+\.)?(\w+)\s*\(/gi,
  )) {
    out.push({ name: m[1], type: "function" });
  }

  return out;
}

export function isRegistered(
  obj: CreatedObject,
  migrationFilename: string,
  manifest: ManifestEntry[],
): boolean {
  return manifest.some(
    (e) =>
      e.name === obj.name &&
      e.type === obj.type &&
      e.migration === migrationFilename,
  );
}
