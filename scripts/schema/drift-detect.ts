/**
 * Schema Drift Detector (SD-C, Phase 1 — report-only)
 *
 * Reads migration history from `supabase_migrations.schema_migrations` and
 * compares the DDL each migration claims to have executed against the live
 * `information_schema` / `pg_catalog` / `pg_indexes`. Produces a structured
 * report listing every expected object (table, column, index, function) that
 * is missing from the live schema.
 *
 * Phase 1: detector exits non-zero on drift but the CI step is wrapped in
 * `continue-on-error: true`. Drift is reported, not blocking. Phase 2 (after
 * SD-A reconciliation) flips that flag.
 *
 * Parser scope: only CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE INDEX /
 * CREATE FUNCTION. False negatives are acceptable; false positives are not.
 *
 * Run locally:
 *   DRIFT_DETECT_DB_URL=postgres://drift_reader:...@host:5432/postgres pnpm gate:schema-drift
 *
 * Spec: specs/schema-drift/SPEC-SD-C-ci-drift-detection.md
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

export type ExpectedObject =
  | { kind: "table"; schema: string; name: string }
  | { kind: "column"; schema: string; table: string; name: string }
  | { kind: "index"; schema: string; name: string }
  | { kind: "function"; schema: string; name: string };

export type DriftFinding = {
  migration_version: string;
  migration_name: string;
  object: ExpectedObject;
  status: "missing";
  source_statement: string;
};

type AllowlistEntry = {
  migration_version: string;
  object:
    | { kind: "table"; schema?: string; name: string }
    | { kind: "column"; schema?: string; table: string; name: string }
    | { kind: "index"; schema?: string; name: string }
    | { kind: "function"; schema?: string; name: string };
  reason: string;
};

// ─── Parser (pure; exported for unit tests) ─────────────────────────────────

export function extractExpectedObjects(statements: string[]): ExpectedObject[] {
  const out: ExpectedObject[] = [];
  for (const stmt of statements) {
    // CREATE TABLE [IF NOT EXISTS] [schema.]name (
    for (const m of stmt.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)\s*\(/gi,
    )) {
      out.push({ kind: "table", schema: m[1] ?? "public", name: m[2] });
    }

    // ALTER TABLE [schema.]name <body>
    // Capture the table once, then extract every ADD COLUMN clause from the body.
    const alterMatch = stmt.match(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:(\w+)\.)?(\w+)\s+([\s\S]+)/i,
    );
    if (alterMatch) {
      const schema = alterMatch[1] ?? "public";
      const table = alterMatch[2];
      for (const colM of alterMatch[3].matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\b/gi,
      )) {
        out.push({ kind: "column", schema, table, name: colM[1] });
      }
    }

    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] idxname ON ...
    for (const m of stmt.matchAll(
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\b/gi,
    )) {
      out.push({ kind: "index", schema: "public", name: m[1] });
    }

    // CREATE [OR REPLACE] FUNCTION [schema.]name (
    for (const m of stmt.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(/gi,
    )) {
      out.push({ kind: "function", schema: m[1] ?? "public", name: m[2] });
    }
  }
  return out;
}

export function statementMentionsObject(
  stmt: string,
  obj: ExpectedObject,
): boolean {
  if (obj.kind === "column") {
    return new RegExp(`\\b${obj.table}\\b[\\s\\S]*\\b${obj.name}\\b`, "i").test(
      stmt,
    );
  }
  return new RegExp(`\\b${obj.name}\\b`, "i").test(stmt);
}

function loadAllowlist(): AllowlistEntry[] {
  try {
    const text = readFileSync(".drift-allowlist.json", "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      console.error(
        "warn: .drift-allowlist.json is not an array; ignoring contents",
      );
      return [];
    }
    return parsed as AllowlistEntry[];
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    console.error(
      `warn: failed to read .drift-allowlist.json: ${(err as Error).message}`,
    );
    return [];
  }
}

export function isAllowed(
  finding: DriftFinding,
  allowlist: AllowlistEntry[],
): boolean {
  return allowlist.some((entry) => {
    if (entry.migration_version !== finding.migration_version) return false;
    if (entry.object.kind !== finding.object.kind) return false;
    if (entry.object.kind === "column" && finding.object.kind === "column") {
      return (
        entry.object.table === finding.object.table &&
        entry.object.name === finding.object.name
      );
    }
    return entry.object.name === (finding.object as { name: string }).name;
  });
}

function describeObject(obj: ExpectedObject): string {
  if (obj.kind === "column") {
    return `${obj.schema}.${obj.table}.${obj.name}`;
  }
  return `${obj.schema}.${obj.name}`;
}

// ─── Main (DB-side; not exported) ───────────────────────────────────────────

async function main(): Promise<void> {
  const conn = process.env.DRIFT_DETECT_DB_URL;
  if (!conn) {
    console.error(
      "DRIFT_DETECT_DB_URL not set. See infrastructure/drift-detection/RUNBOOK.md.",
    );
    process.exit(2);
  }

  const sql = postgres(conn, { ssl: "require", prepare: false, max: 1 });

  try {
    // 1. Pull migration history with full statements.
    const migrations = await sql<
      Array<{ version: string; name: string; statements: string[] }>
    >`
      SELECT version, name, statements
      FROM supabase_migrations.schema_migrations
      ORDER BY version
    `;

    // 2. Pull live schema state.
    const tableRows = await sql<Array<{ table_schema: string; table_name: string }>>`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const tables = new Set(
      tableRows.map((r) => `${r.table_schema}.${r.table_name}`),
    );

    const columnRows = await sql<
      Array<{ table_schema: string; table_name: string; column_name: string }>
    >`
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    const columns = new Set(
      columnRows.map(
        (r) => `${r.table_schema}.${r.table_name}.${r.column_name}`,
      ),
    );

    const indexRows = await sql<
      Array<{ schemaname: string; indexname: string }>
    >`
      SELECT schemaname, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;
    const indexes = new Set(
      indexRows.map((r) => `${r.schemaname}.${r.indexname}`),
    );

    const functionRows = await sql<
      Array<{ nspname: string; proname: string }>
    >`
      SELECT n.nspname, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    `;
    const functions = new Set(
      functionRows.map((r) => `${r.nspname}.${r.proname}`),
    );

    // 3. Compare each migration's expected objects against live state.
    const findings: DriftFinding[] = [];
    for (const m of migrations) {
      const expected = extractExpectedObjects(m.statements ?? []);
      for (const exp of expected) {
        const present =
          exp.kind === "table"
            ? tables.has(`${exp.schema}.${exp.name}`)
            : exp.kind === "column"
              ? columns.has(`${exp.schema}.${exp.table}.${exp.name}`)
              : exp.kind === "index"
                ? indexes.has(`${exp.schema}.${exp.name}`)
                : functions.has(`${exp.schema}.${exp.name}`);
        if (present) continue;

        const sourceStatement = (
          (m.statements ?? []).find((s) => statementMentionsObject(s, exp)) ??
          ""
        ).slice(0, 240);
        findings.push({
          migration_version: m.version,
          migration_name: m.name,
          object: exp,
          status: "missing",
          source_statement: sourceStatement,
        });
      }
    }

    // 4. Apply allow-list to separate blocking from acknowledged drift.
    const allowlist = loadAllowlist();
    const blocking = findings.filter((f) => !isAllowed(f, allowlist));

    // 5. Persist reports.
    mkdirSync(".drift_report", { recursive: true });
    writeFileSync(
      ".drift_report/all-findings.json",
      JSON.stringify(findings, null, 2),
    );
    writeFileSync(
      ".drift_report/blocking-findings.json",
      JSON.stringify(blocking, null, 2),
    );

    // 6. Console summary.
    console.log(
      `Drift findings: ${findings.length} total, ${blocking.length} blocking`,
    );
    if (blocking.length > 0) {
      console.log("\nBlocking findings (first 20):");
      for (const f of blocking.slice(0, 20)) {
        console.log(
          `  ${f.migration_version} (${f.migration_name}): missing ${f.object.kind} ${describeObject(f.object)}`,
        );
      }
      if (blocking.length > 20) {
        console.log(
          `  ... and ${blocking.length - 20} more (see .drift_report/blocking-findings.json)`,
        );
      }
      process.exitCode = 1;
      return;
    }

    console.log("✅ No blocking drift detected");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Only invoke main when run as a script, not when imported by tests.
const invokedDirectly =
  process.argv[1] && /drift-detect\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
