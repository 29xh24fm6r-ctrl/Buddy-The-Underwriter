#!/usr/bin/env node
/**
 * CI guard — SPEC-SYSTEM-DEBLOAT-1 Phase C2/C3.
 *
 * Once a table is dropped (its DDL backed up under docs/audit/dropped-ddl/),
 * this guard fails CI if a `.from("<dropped-table>")` / `.from('<dropped-table>')`
 * / `` .from(`<dropped-table>`) `` string reappears anywhere in the app — a
 * resurrected reference to a table that no longer exists in production is
 * exactly the kind of break the schema-inventory review
 * (docs/audit/schema-inventory-2026-07.md) was supposed to rule out before
 * drop.
 *
 * Dropped-table list is derived from docs/audit/dropped-ddl/*.sql — every
 * file there is a table that has actually been through the C2 drop-batch
 * process (DDL exported before the drop PR merged). Scans src/, services/,
 * and scripts/ — not just src/ — per the Phase C1 finding that this repo's
 * standalone services (franchise-sync-worker, pulse-mcp, etc.) reference
 * tables outside src/ entirely, via raw SQL as well as `.from()`.
 *
 * SPEC-DRIFT-HARDENING-1 D1: the original match required the closing paren
 * immediately after the closing quote (`.from("table")`), so appending an
 * inline TypeScript type cast after the quoted table name (e.g. "as any")
 * silently evaded it — that's exactly how a reference to a dropped table
 * (aegis_recording_sessions) escaped this guard on 2026-07-30. The pattern
 * below tolerates any non-`)` content (casts, whitespace, `as const`)
 * between the closing quote and the closing paren, and accepts backtick
 * template-literal form as well as single/double quotes.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const REPO_ROOT = process.env.DROPPED_TABLES_REPO_ROOT || process.cwd();
const SCAN_DIRS = process.env.DROPPED_TABLES_SCAN_DIRS
  ? process.env.DROPPED_TABLES_SCAN_DIRS.split(",")
  : ["src", "services", "scripts"];
const DDL_DIR = process.env.DROPPED_TABLES_DDL_DIR
  || join(REPO_ROOT, "docs/audit/dropped-ddl");

function collect(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "__tests__") continue;
      collect(full, acc);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e)) {
      acc.push(full);
    }
  }
  return acc;
}

let droppedTables = [];
try {
  droppedTables = readdirSync(DDL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => basename(f, ".sql"));
} catch {
  // No drops yet — nothing to guard.
}

if (droppedTables.length === 0) {
  console.log("✅ guard-dropped-tables passed (0 dropped tables tracked yet).");
  process.exit(0);
}

// Matches `.from("table")` / `.from('table')` / `` .from(`table`) `` for any
// dropped table name, tolerant of casts or whitespace before the closing
// paren (e.g. `.from("table" as any)`, `.from( "table" )`).
const patterns = droppedTables.map((t) => {
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    name: t,
    re: new RegExp(`\\.from\\(\\s*(["'\`])${escaped}\\1[^)]*\\)`),
  };
});

const offenders = [];
for (const dir of SCAN_DIRS) {
  for (const file of collect(join(REPO_ROOT, dir))) {
    const rel = relative(REPO_ROOT, file);
    const content = readFileSync(file, "utf8");
    for (const { name, re } of patterns) {
      if (re.test(content)) {
        offenders.push({ file: rel, table: name });
      }
    }
  }
}

if (offenders.length) {
  console.error("\n❌ Reference to a DROPPED table found (SPEC-SYSTEM-DEBLOAT-1 Phase C2):\n");
  for (const o of offenders) console.error(` - ${o.file}  →  .from("${o.table}")`);
  console.error(
    "\nThis table was dropped from production — see docs/audit/dropped-ddl/<table>.sql " +
      "for its last-known schema and docs/audit/schema-inventory-2026-07.md for the " +
      "classification that approved dropping it. Remove the reference, or if the table " +
      "is genuinely needed again, that's a new migration + inventory update, not a revert.\n",
  );
  process.exit(1);
}

console.log(`✅ guard-dropped-tables passed (${droppedTables.length} dropped table(s) tracked, 0 offending references).`);
