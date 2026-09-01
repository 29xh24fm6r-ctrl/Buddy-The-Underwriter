#!/usr/bin/env node
/**
 * CI guard — the credit memo has exactly one coverage-threshold authority.
 *
 * The memo used to decide its DSCR floor in seven independent places. Five
 * typed 1.25; the covenant engine used 1.20. Meanwhile the governed axis is
 * product-dependent, and `policyProductId` routes any 7(a) at or below
 * $500,000 to SBA_7A_SMALL, whose floor is 1.20. A small 7(a) at 1.22x
 * coverage therefore shipped a memo whose covenant correctly stated 1.20x
 * beside a policy exception reading "below policy minimum of 1.25x" — a
 * fabricated breach, in the document a lender signs. The institutional
 * reviewer blocked two production runs on precisely that contradiction.
 *
 * Every coverage threshold the memo cites now comes from
 * memoThresholdAuthority.resolveMemoThresholds, which resolves the governed
 * registry once per memo. This guard keeps it that way: a coverage literal
 * reintroduced anywhere on the credit-memo surface fails the build.
 *
 * It deliberately does NOT ban the numbers outright. It bans them on lines
 * that are talking about coverage, which is where they do harm.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const SURFACE = join(REPO_ROOT, "src/lib/creditMemo");

/**
 * Files that legitimately carry a coverage number.
 *   - memoThresholdAuthority.ts is the authority itself.
 *   - buildStressTestTable.ts names breakeven_ebitda_125x as a field, a
 *     historical column name rather than a decision.
 */
const EXEMPT_FILES = new Set([
  "canonical/memoThresholdAuthority.ts",
]);

/**
 * `committee/` is presentation advice — "lead with the DSCR", "frame it as a
 * collateral cushion" — not an assertion that the deal clears policy. Its
 * numbers are also mostly collateral-coverage, an axis the registry does not
 * govern, so routing them through resolveMemoThresholds would invent a
 * resolution rather than remove one. Excluded deliberately; if a policy claim
 * ever moves into that surface it belongs on the authority like the rest.
 */
const EXEMPT_DIRS = new Set(["committee"]);

/** Coverage thresholds a lender would recognise as a policy line. */
const COVERAGE_LITERAL = /(?<![\w.])1\.(?:1|10|15|2|20|25|3|30|35|5|50)(?![\w])/;

/**
 * The line has to be about DEBT-SERVICE coverage for the literal to be a
 * policy threshold. Collateral coverage is a separate axis with no governed
 * registry entry, so it is not matched here.
 */
const COVERAGE_CONTEXT =
  // No word boundary after "dscr": the identifiers in this codebase are
  // dscrGlobal, dscrStressed300bps, dscr_floor. Requiring \bdscr\b made this
  // guard pass on `dscrGlobal.value < 1.25`, which is the exact line it exists
  // to catch — verified by planting that literal and watching it slip through.
  /dscr|fccr|fixed[_\s-]?charge|debt[_\s-]?service|policy[_\s-]?min|policy[_\s-]?floor|institutional (?:minimum|floor)/i;

/** Ratios that are multipliers on a resolved floor, not thresholds themselves. */
const IS_MULTIPLIER = /\*\s*1\.(?:2|25|5)|1\.(?:2|25|5)\s*\*/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      if (EXEMPT_DIRS.has(entry) && dir === SURFACE) continue;
      walk(full, out);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function stripComments(line) {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

const violations = [];

for (const file of walk(SURFACE)) {
  const rel = relative(SURFACE, file).split("\\").join("/");
  if (EXEMPT_FILES.has(rel)) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  let inBlockComment = false;

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;

    const code = stripComments(raw);
    if (!COVERAGE_LITERAL.test(code)) return;
    if (!COVERAGE_CONTEXT.test(code)) return;
    if (IS_MULTIPLIER.test(code)) return;

    violations.push({
      file: `src/lib/creditMemo/${rel}`,
      line: i + 1,
      text: trimmed.slice(0, 140),
    });
  });
}

if (violations.length > 0) {
  console.error("guard-memo-threshold-authority — FAILED\n");
  console.error(
    "A coverage threshold is hard-coded on the credit-memo surface. Resolve it\n" +
    "through resolveMemoThresholds() instead, so the covenant package, the\n" +
    "policy exceptions and the ratio interpretations cannot disagree inside one\n" +
    "memo. See src/lib/creditMemo/canonical/memoThresholdAuthority.ts.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}\n    ${v.text}`);
  }
  process.exit(1);
}

console.log("✅ guard-memo-threshold-authority passed — one coverage authority on the memo surface.");
