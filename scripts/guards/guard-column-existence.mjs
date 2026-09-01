// scripts/guards/guard-column-existence.mjs
//
// Column existence guard.
//
// PostgREST rejects an entire request when a select or filter names a column
// that does not exist — it does not silently ignore it. So a single stale
// column name takes down the whole query, and the failure only shows up at
// runtime, on the one code path that runs it.
//
// This repo has been bitten by exactly that, repeatedly:
//   • `deals.amount` was referenced in nine files. The column has only ever
//     been `loan_amount`, so every one of those reads returned nothing.
//   • `lender_marketplace_agreements.signed_by_email` was never created, so
//     recipient lookup threw and no lender notification was ever sent.
//
// The guard compares every `.from("table").select(…)` and chained filter in
// src/ against a snapshot of the live schema (schema-columns.json), and fails
// on any column the snapshot does not have.
//
// Known pre-existing breaks live in column-existence-baseline.txt. That file is
// REMOVE-ONLY: fixing a reference means deleting its line. Adding a line to get
// a new PR green defeats the guard and will not be accepted.
//
// Refreshing the snapshot: regenerate it from the live database after applying
// a migration. Columns are only ever added to it by a real schema change.
//
// Env overrides (fixture tests): COLUMN_GUARD_SRC_DIR, COLUMN_GUARD_SCHEMA,
// COLUMN_GUARD_BASELINE.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = process.env.COLUMN_GUARD_SRC_DIR || path.join(ROOT, "src");
const SCHEMA_PATH = process.env.COLUMN_GUARD_SCHEMA || path.join(ROOT, "scripts/guards/schema-columns.json");
const BASELINE_PATH = process.env.COLUMN_GUARD_BASELINE || path.join(ROOT, "scripts/guards/column-existence-baseline.txt");

// Chained methods whose first string argument is a bare column name.
const FILTER_METHODS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
  "contains", "containedBy", "overlaps", "order",
];

// Select entries that are not columns.
const SELECT_NON_COLUMNS = new Set(["*", "count", ""]);

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (entry.isFile() && test(entry.name)) out.push(full);
  }
  return out;
}

function loadSchema() {
  const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const byTable = new Map();
  for (const [table, cols] of Object.entries(raw)) byTable.set(table, new Set(cols));
  return byTable;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  return new Set(
    fs
      .readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

// A plain string literal, or null when the argument is dynamic (template
// interpolation, a variable, a concatenation) and therefore unparseable.
export function literalAt(source, openParenIndex) {
  let i = openParenIndex + 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let out = "";
  i += 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") { out += source[i + 1] ?? ""; i += 2; continue; }
    if (ch === quote) return quote === "`" && out.includes("${") ? null : out;
    if (quote === "`" && ch === "$" && source[i + 1] === "{") return null;
    out += ch;
    i += 1;
  }
  return null;
}

// Split on commas that are not inside an embedded-resource parenthesis.
export function splitTopLevel(spec) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of spec) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/**
 * Column references in one PostgREST select spec, resolved against the table
 * each belongs to. Embedded resources (`org:crm_organizations(name)`) shift the
 * inner columns onto the related table; when that relation is not a table we
 * recognise, its inner columns are skipped rather than guessed at.
 */
export function selectReferences(table, spec, knownTables) {
  const refs = [];
  for (const rawItem of splitTopLevel(spec)) {
    const item = rawItem.replace(/\s+/g, "");
    const paren = item.indexOf("(");
    if (paren !== -1) {
      const head = item.slice(0, paren);
      const inner = item.slice(paren + 1, item.lastIndexOf(")"));
      // `alias:relation!hint(cols)` — the relation is what follows any alias.
      const relation = head.split(":").pop().split("!")[0];
      if (knownTables.has(relation)) refs.push(...selectReferences(relation, inner, knownTables));
      continue;
    }
    // `alias:column`, `column->>path`, `column::cast`, `column!hint`.
    // Order matters: a cast is written `::`, so it has to come off before the
    // single-colon alias split or `id::text` reads as an alias named `id`.
    let name = item.split("::")[0].split("->")[0];
    name = name.split(":").pop().split("!")[0];
    if (SELECT_NON_COLUMNS.has(name) || !IDENTIFIER.test(name)) continue;
    refs.push({ table, column: name });
  }
  return refs;
}

/**
 * Every column reference in a source file, attributed to the table of the
 * `.from("table")` that opens its chain. A chain ends at the next `.from(`,
 * so a select never bleeds onto the previous table.
 */
export function fileReferences(source, knownTables) {
  const refs = [];
  const fromRe = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/gi;
  const starts = [];
  let m;
  while ((m = fromRe.exec(source)) !== null) starts.push({ table: m[1], at: m.index, end: fromRe.lastIndex });

  for (let i = 0; i < starts.length; i += 1) {
    const { table, end } = starts[i];
    const stop = i + 1 < starts.length ? starts[i + 1].at : source.length;
    const chain = source.slice(end, stop);

    const selectRe = /\.select\(/g;
    while ((m = selectRe.exec(chain)) !== null) {
      const spec = literalAt(chain, selectRe.lastIndex - 1);
      if (spec === null) continue;
      refs.push(...selectReferences(table, spec, knownTables).map((r) => ({ ...r, offset: end + m.index })));
    }

    for (const method of FILTER_METHODS) {
      const re = new RegExp(`\\.${method}\\(`, "g");
      while ((m = re.exec(chain)) !== null) {
        const arg = literalAt(chain, re.lastIndex - 1);
        if (arg === null) continue;
        // Dotted arguments address an embedded resource, not this table.
        if (!IDENTIFIER.test(arg)) continue;
        refs.push({ table, column: arg, offset: end + m.index });
      }
    }
  }
  return refs;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function main() {
  const schema = loadSchema();
  const baseline = loadBaseline();
  const knownTables = new Set(schema.keys());

  const files = walk(SRC_DIR, (n) => /\.(ts|tsx)$/.test(n)).filter(
    // Test files carry stub tables and deliberately malformed fixtures; they
    // are not runtime queries.
    (f) => !/__tests__|\.test\.tsx?$/.test(f),
  );

  const violations = [];
  const usedBaselineEntries = new Set();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const ref of fileReferences(source, knownTables)) {
      const columns = schema.get(ref.table);
      if (!columns || columns.has(ref.column)) continue;
      const key = `${ref.table}.${ref.column}`;
      if (baseline.has(key)) { usedBaselineEntries.add(key); continue; }
      violations.push({ key, file: path.relative(ROOT, file), line: lineOf(source, ref.offset) });
    }
  }

  const stale = [...baseline].filter((k) => !usedBaselineEntries.has(k));

  if (violations.length) {
    console.error(`\n✖ column existence guard: ${violations.length} reference(s) to columns that do not exist\n`);
    const seen = new Set();
    for (const v of violations) {
      const id = `${v.key}@${v.file}:${v.line}`;
      if (seen.has(id)) continue;
      seen.add(id);
      console.error(`  ${v.key}\n      ${v.file}:${v.line}`);
    }
    console.error(
      "\nPostgREST rejects the whole request on an unknown column, so each of these\n" +
        "silently breaks its query at runtime. Fix the column name, or add the column\n" +
        "in a migration and refresh scripts/guards/schema-columns.json.\n",
    );
    process.exit(1);
  }

  if (stale.length) {
    console.error(`\n✖ column existence guard: ${stale.length} stale baseline entr(ies)\n`);
    for (const k of stale) console.error(`  ${k}`);
    console.error(
      "\nThese are no longer referenced anywhere. Delete them from\n" +
        "scripts/guards/column-existence-baseline.txt — the baseline is remove-only.\n",
    );
    process.exit(1);
  }

  console.log(
    `✓ column existence guard: ${files.length} files checked against ${schema.size} tables` +
      (baseline.size ? ` (${baseline.size} baselined)` : ""),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
