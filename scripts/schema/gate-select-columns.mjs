/**
 * Schema Audit Gate: No Unknown Columns in Select Strings
 *
 * Prevents the bug class where code selects non-existent columns from
 * Supabase tables (e.g., entity_name on deal_documents), causing PostgREST
 * 400 errors that are silently swallowed as "no data".
 *
 * How it works:
 *   1. Parses all SQL migrations to build { table → Set(columns) }
 *   2. Scans TypeScript for .from("TABLE").select("...") patterns
 *   3. Flags any selected column not found in the schema map
 *
 * Run: pnpm gate:schema-select
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SRC_DIR = path.join(ROOT, "src");
const BASELINE_PATH = path.join(
  ROOT,
  "scripts",
  "schema",
  "schema-baseline.json",
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readAllFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readAllFiles(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

function normIdent(s) {
  return s
    .replace(/"/g, "")
    .replace(/^public\./, "")
    .trim()
    .toLowerCase();
}

/**
 * Find the body of a CREATE TABLE statement, handling nested parentheses
 * (e.g., CHECK constraints, DEFAULT gen_random_uuid(), etc.)
 */
function findCreateTableBody(sql, startIndex) {
  let depth = 0;
  let bodyStart = -1;
  for (let i = startIndex; i < sql.length; i++) {
    if (sql[i] === "(") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        return sql.slice(bodyStart, i);
      }
    }
  }
  return null;
}

// ─── SQL Schema Parser ──────────────────────────────────────────────────────

function parseSchema(sqlText) {
  const tables = new Map();

  // Find all CREATE TABLE statements and extract bodies with balanced parens
  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)\s*\(/gi;
  let m;
  while ((m = createRe.exec(sqlText))) {
    const table = normIdent(m[1]).split(".").pop();
    // Re-scan from match start for balanced parens
    const body = findCreateTableBody(sqlText, m.index + m[0].length - 1);
    if (!body) continue;

    const cols = tables.get(table) ?? new Set();

    for (const line of body.split("\n")) {
      const l = line.trim().replace(/,\s*$/, "");
      if (!l || l.startsWith("--")) continue;

      // Column def: <colname> <type> ...
      const colMatch = /^("?[a-zA-Z_][\w$]*"?)\s+/.exec(l);
      if (!colMatch) continue;

      const col = normIdent(colMatch[1]);
      // Skip constraints and table-level declarations
      if (
        [
          "constraint",
          "primary",
          "foreign",
          "unique",
          "check",
          "exclude",
          "like",
          "inherits",
          "partition",
        ].includes(col)
      )
        continue;
      cols.add(col);
    }
    tables.set(table, cols);
  }

  // ALTER TABLE [IF EXISTS] <name> ADD COLUMN [IF NOT EXISTS] <col> <type>
  // Handles multi-column ALTER TABLE: ALTER TABLE t ADD COLUMN a text, ADD COLUMN b text;
  const alterStmtRe =
    /alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)\s+([\s\S]*?);/gi;
  while ((m = alterStmtRe.exec(sqlText))) {
    const table = normIdent(m[1]).split(".").pop();
    const body = m[2];
    const addColRe =
      /add\s+column\s+(?:if\s+not\s+exists\s+)?("?[a-zA-Z_][\w$]*"?)/gi;
    let cm;
    while ((cm = addColRe.exec(body))) {
      const col = normIdent(cm[1]);
      const cols = tables.get(table) ?? new Set();
      cols.add(col);
      tables.set(table, cols);
    }
  }

  // ALTER TABLE [IF EXISTS] <name> RENAME COLUMN <old> TO <new>
  const renameRe =
    /alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)\s+rename\s+column\s+("?[a-zA-Z_][\w$]*"?)\s+to\s+("?[a-zA-Z_][\w$]*"?)/gi;
  while ((m = renameRe.exec(sqlText))) {
    const table = normIdent(m[1]).split(".").pop();
    const oldCol = normIdent(m[2]);
    const newCol = normIdent(m[3]);
    const cols = tables.get(table) ?? new Set();
    cols.delete(oldCol);
    cols.add(newCol);
    tables.set(table, cols);
  }

  // ALTER TABLE [IF EXISTS] <name> DROP COLUMN [IF EXISTS] <col>
  const dropRe =
    /alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)\s+drop\s+column\s+(?:if\s+exists\s+)?("?[a-zA-Z_][\w$]*"?)/gi;
  while ((m = dropRe.exec(sqlText))) {
    const table = normIdent(m[1]).split(".").pop();
    const col = normIdent(m[2]);
    const cols = tables.get(table);
    if (cols) cols.delete(col);
  }

  return tables;
}

function mergeSchemas(all) {
  const merged = new Map();
  for (const schema of all) {
    for (const [t, cols] of schema.entries()) {
      const set = merged.get(t) ?? new Set();
      for (const c of cols) set.add(c);
      merged.set(t, set);
    }
  }
  return merged;
}

/** Set of tables tracked in the baseline file. Only these are validated. */
const baselineTables = new Set();

/**
 * Load the baseline schema file (columns for tables created outside migrations).
 * Merges into the given schema map.
 */
function loadBaseline(schema) {
  if (!fs.existsSync(BASELINE_PATH)) return;
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  let added = 0;
  for (const [table, cols] of Object.entries(raw)) {
    if (table.startsWith("_")) continue; // skip comments
    if (!Array.isArray(cols)) continue;
    baselineTables.add(table);
    const set = schema.get(table) ?? new Set();
    for (const c of cols) {
      set.add(c.toLowerCase());
      added++;
    }
    schema.set(table, set);
  }
  console.log(
    `Loaded baseline: ${added} columns across ${baselineTables.size} tables (only these are validated)`,
  );
}

// ─── TypeScript Select Scanner ──────────────────────────────────────────────

function parseSelectCols(selectStr) {
  // Split by comma BUT respect nested parentheses (PostgREST joins).
  // "*, bank:banks(id, code, name), stage" → ["*", "bank:banks(id, code, name)", "stage"]
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selectStr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts
    .filter(Boolean)
    .map((s) => {
      // Handle PostgREST relation expansions: "relation(col1, col2)" → skip
      if (s.includes("(")) return null;
      if (s.includes(")")) return null;
      // Handle aliases: "col:alias" → take "col"
      // Handle PostgREST cast: "col::type" → take "col"
      const base = s.split(":")[0].trim();
      // Handle "col.nested" (JSON) → skip
      if (base.includes(".")) return null;
      // Handle "-col" (negation in select) → take "col"
      const cleaned = base.replace(/^-/, "");
      // Handle "col!inner" → take "col"
      const final = cleaned.split("!")[0].trim().toLowerCase();
      return final || null;
    })
    .filter((s) => s && s !== "*");
}

function scanSource(schema) {
  const files = readAllFiles(SRC_DIR, [".ts", ".tsx"]);
  const findings = [];

  // Match .from("table").select("columns") — .select() must appear within
  // 200 chars of .from() to avoid cross-statement false positives.
  // This covers: .from("t").select("..."), .from("t")\n    .select("..."),
  // and .from("t")\n    .select(\n      "..."\n    )
  const fromSelectRe =
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]{0,200}?\.select\(\s*\n?\s*["'`]([^"'`]*?)["'`]/g;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");

    fromSelectRe.lastIndex = 0;
    let m;
    while ((m = fromSelectRe.exec(text))) {
      const tableRaw = m[1];
      const table = tableRaw.split(".").pop().toLowerCase();
      const selectStr = m[2];

      const known = schema.get(table);
      if (!known || known.size === 0) continue; // table not tracked

      // Only validate tables in the baseline (focused mode).
      // Tables not in baseline lack full schema coverage from migrations.
      if (!baselineTables.has(table)) continue;

      const cols = parseSelectCols(selectStr);

      for (const col of cols) {
        if (!known.has(col)) {
          const beforeMatch = text.slice(0, m.index);
          const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
          findings.push({
            file,
            table,
            col,
            lineNum,
            selectStr: selectStr.slice(0, 120),
          });
        }
      }
    }
  }

  return findings;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const migrationFiles = fs.existsSync(MIGRATIONS_DIR)
  ? readAllFiles(MIGRATIONS_DIR, [".sql"]).sort()
  : [];

if (migrationFiles.length === 0) {
  console.warn("No migration files found in", MIGRATIONS_DIR);
  process.exit(0);
}

const schemas = migrationFiles.map((f) =>
  parseSchema(fs.readFileSync(f, "utf8")),
);
const schema = mergeSchemas(schemas);

// Load baseline for tables without tracked CREATE TABLE
loadBaseline(schema);

// Summary
let totalCols = 0;
for (const cols of schema.values()) totalCols += cols.size;
console.log(
  `Parsed ${migrationFiles.length} migrations -> ${schema.size} tables, ${totalCols} columns`,
);

const findings = scanSource(schema);

if (findings.length > 0) {
  console.error(
    `\n--- FAIL: ${findings.length} unknown column(s) in .select() strings ---\n`,
  );
  for (const f of findings.slice(0, 50)) {
    const rel = path.relative(ROOT, f.file);
    console.error(`  ${rel}:${f.lineNum}`);
    console.error(`    table:  ${f.table}`);
    console.error(`    column: ${f.col}`);
    console.error(`    select: "${f.selectStr}"`);
    console.error();
  }
  if (findings.length > 50) {
    console.error(`  ... and ${findings.length - 50} more`);
  }
  process.exit(1);
}

console.log("gate-select-columns: PASS");
