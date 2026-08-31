import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * `deals` has `loan_amount`. It has never had `amount`.
 *
 * Two shipped pages selected `amount` anyway. PostgREST rejects the entire
 * request on an unknown column, so neither page showed a database error — the
 * brokerage pipeline rendered "No deals in the pipeline" over a full book of
 * business, and the shared /deals page silently fell back to a reduced query
 * that drops amount, stage, status and the archived filter. Both failure
 * modes look like ordinary empty or sparse data, which is why the bug
 * survived in production.
 *
 * Typecheck cannot catch this (it does not know the database's columns) and
 * no test exercised the queries, so this asserts the column names directly.
 */

const PHANTOM = "amount";
const REAL = "loan_amount";

/** Every .ts/.tsx file under src, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function parseColumnLiteral(literal: string): string[] {
  return literal
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("")
    .replace(/["+]/g, "")
    .split(",")
    .map((column) => column.trim())
    .filter((column) => /^[a-z_]+$/.test(column));
}

/**
 * Column names inside a `.select(…)` that follows a `.from("deals")`.
 *
 * Handles both forms this repo uses: an inline string literal (possibly
 * concatenated across lines) and a `const selectPrimary = "…"` passed by
 * name. The variable form is why /deals hid this bug the longest, so a guard
 * that only read inline literals would have the same blind spot as the code
 * it is guarding. Anything else it cannot parse is skipped rather than
 * guessed at.
 */
function dealsSelectColumns(source: string): string[] {
  const columns: string[] = [];
  const fromDeals = /\.from\(\s*["']deals["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = fromDeals.exec(source))) {
    const after = source.slice(match.index, match.index + 1200);

    const inline = /\.select\(\s*((?:\s*"[^"]*"\s*\+?)+)/.exec(after);
    if (inline) {
      columns.push(...parseColumnLiteral(inline[1]));
      continue;
    }

    // .select(selectPrimary) — resolve the identifier to its declaration.
    const byName = /\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(after);
    if (!byName) continue;
    const declaration = new RegExp(
      `(?:const|let|var)\\s+${byName[1]}\\s*(?::[^=]+)?=\\s*((?:\\s*"[^"]*"\\s*\\+?)+)`,
    ).exec(source);
    if (declaration) columns.push(...parseColumnLiteral(declaration[1]));
  }
  return columns;
}

test("no deals query selects the phantom `amount` column", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('.from("deals")') && !source.includes(".from('deals')")) continue;
    if (dealsSelectColumns(source).includes(PHANTOM)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `deals has ${REAL}, not ${PHANTOM}`);
});

test("the two pages that carried the bug now select loan_amount", () => {
  for (const file of [
    "src/app/admin/brokerage/pipeline/page.tsx",
    "src/app/(app)/deals/page.tsx",
  ]) {
    const columns = dealsSelectColumns(readFileSync(file, "utf8"));
    assert.ok(columns.includes(REAL), `${file} does not select ${REAL}`);
    assert.equal(columns.includes(PHANTOM), false, `${file} still selects ${PHANTOM}`);
  }
});

test("the parser it relies on actually detects the phantom column", () => {
  // A guard that cannot fail is not a guard.
  const bad = `sb.from("deals").select("id, name, amount, stage")`;
  const good = `sb.from("deals").select("id, name, loan_amount, stage")`;
  assert.ok(dealsSelectColumns(bad).includes(PHANTOM));
  assert.equal(dealsSelectColumns(good).includes(PHANTOM), false);
  assert.ok(dealsSelectColumns(good).includes(REAL));
});

test("the parser sees a select passed by variable, not just inline", () => {
  // /deals uses this form, and it is where the bug hid longest.
  const viaVariable = [
    'const selectPrimary = "id, name, amount, stage";',
    'sb.from("deals").select(selectPrimary).eq("bank_id", bankId);',
  ].join("\n");
  assert.ok(dealsSelectColumns(viaVariable).includes(PHANTOM));

  const fixed = viaVariable.replace("amount", "loan_amount");
  assert.equal(dealsSelectColumns(fixed).includes(PHANTOM), false);
  assert.ok(dealsSelectColumns(fixed).includes(REAL));
});

test("archived_at, which the same queries filter on, has a migration", () => {
  // It was declared in January and never applied, so those filters failed too.
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const declares = migrations.some((file) =>
    /add column if not exists archived_at/i.test(
      readFileSync(join("supabase/migrations", file), "utf8"),
    ),
  );
  assert.ok(declares, "no migration declares deals.archived_at");
});
