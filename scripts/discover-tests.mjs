// scripts/discover-tests.mjs
// SPEC-CI-1 — test:unit discovery.
//
// Prints the newline-separated list of unit-test files for `node --test`.
// Broadened from the old `find src/lib scripts src/app -path '*/__tests__/*.test.ts'`
// (which missed src/components, src/core, src/buddy, .test.tsx, and .test.ts files
// outside __tests__/ — ~143 files) to every *.test.ts / *.test.tsx under src + scripts.
//
// Exclusions:
//   - node_modules
//   - __invariants__ — owned by the `test:invariants` runner, not test:unit.
//   - QUARANTINE — individually named files that cannot run under node --test
//     (import errors). Each carries a SPEC-CI-2 reason and is inventoried in
//     specs/ci-2/backlog.md. This list is remove-only.
//
// FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): paths containing `[`
// or `]` (Next.js dynamic-segment dirs, e.g. `[dealId]`) were previously
// excluded entirely with the comment "node --test cannot resolve these (runs
// 0 tests silently, memory #30)". That's half-true: `node --test <path>`
// treats its positional args as glob patterns, and `[dealId]` parses as a
// glob character class rather than a literal directory name — so the file
// resolves to nothing and node --test silently reports "0 tests, 0 fail"
// instead of erroring, with zero signal that a real test file was skipped.
// The actual fix is to escape each literal `[`/`]` as the single-char glob
// class `[[]`/`[]]` in the printed path (verified: 9 test files across the
// repo, 54 tests total, were dead this way — all pass once escaped). Paths
// containing `(` (Next.js route groups, e.g. `(app)`) were also excluded but
// were never actually a problem — `(`/`)` aren't glob metacharacters here;
// removing that exclusion needed no escaping to work.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.DISCOVER_ROOT || process.cwd();
const SCAN_DIRS = ["src", "scripts"];

// SPEC-CI-2 quarantine — files that error at import time under node --test.
const QUARANTINE = new Set([
  // Imports a module chain that pulls in "server-only" (not resolvable under
  // node --test → "Cannot find module 'server-only'"). Class C harness issue.
  "src/core/nextStep/__tests__/computeNextStep.test.ts",
  // financialViabilityAnalysis.ts has `import "server-only"` — the package
  // throws unconditionally unless resolved with the `react-server` export
  // condition, which plain `node --test` doesn't set. Passes under
  // `node --conditions=react-server --test ...` (see
  // docs/archive/brokerage-sba-ready-v1/T1-AAR.md).
  "src/lib/feasibility/__tests__/financialViabilityAnalysis.test.ts",
]);

function isExcludedPath(rel) {
  if (rel.includes("node_modules")) return true;
  if (rel.includes("__invariants__")) return true;
  if (QUARANTINE.has(rel)) return true;
  return false;
}

/** Escape literal `[`/`]` as single-char glob classes so node --test's
 * glob-pattern argument parsing resolves them as literal directory names
 * instead of (mis)parsing them as character classes. */
function escapeForNodeTestGlob(rel) {
  let out = "";
  for (const ch of rel) {
    if (ch === "[") out += "[[]";
    else if (ch === "]") out += "[]]";
    else out += ch;
  }
  return out;
}

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(rel, out);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(d))
  .map((f) => f.split(path.sep).join("/"))
  .filter((rel) => !isExcludedPath(rel))
  .sort()
  .map(escapeForNodeTestGlob);

process.stdout.write(files.join("\n") + "\n");
