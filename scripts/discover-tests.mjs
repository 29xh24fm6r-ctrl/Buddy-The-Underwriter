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
// Dynamic-segment paths (`[dealId]`, `[token]`) need care: `node --test`
// treats its positional arguments as GLOB PATTERNS, so `[dealId]` parses as a
// character class rather than a literal directory name, resolves to nothing,
// and node reports "0 tests, 0 fail" with no signal that a real file was
// skipped.
//
// This was previously handled by printing each `[`/`]` as the glob class
// `[[]`/`[]]`. That escaping is correct in isolation and its guard verified
// the printed strings round-tripped — but the strings were never the thing
// that mattered. package.json invoked the runner as
// `node --test --import tsx $(node scripts/discover-tests.mjs)`, and the
// UNQUOTED command substitution let the SHELL glob-expand `[[]dealId[]]`
// straight back to the literal `[dealId]` before node ever saw it. Node then
// globbed that to nothing, exactly as before. Seventeen test files — every
// test under a dynamic-route directory, including the borrower portal's
// identity, owners, and assumptions-confirm routes and the seal route's
// hostile-interrogation wiring — silently contributed zero tests to CI while
// the coverage-floor guard counted them as discovered (audit F-24).
//
// Two changes fix it, and both are needed:
//   1. `?` instead of `[[]`/`[]]`. A single-char wildcard matches the literal
//      bracket and survives as a pattern node can resolve.
//   2. scripts/run-unit-tests.mjs spawns node with shell:false, so no shell
//      ever gets a chance to expand the pattern first. The CLI output of this
//      file must NOT be used through an unquoted `$(...)` again.
// Each emitted pattern is checked to resolve to exactly one discovered file,
// so an ambiguous or non-resolving wildcard fails the run instead of quietly
// selecting the wrong file or nothing.
//
// Paths containing `(` (Next.js route groups, e.g. `(app)`) were never a
// problem — `(`/`)` aren't glob metacharacters here.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.DISCOVER_ROOT || process.cwd();
const SCAN_DIRS = ["src", "scripts"];

// Files that resolve `server-only` correctly ONLY under the `react-server`
// export condition, which plain `node --test` does not set. They are excluded
// from the default list and run by `test:unit:react-server` instead, so they
// are covered by CI rather than silently skipped.
//
// These were previously lumped into QUARANTINE below and therefore never ran
// anywhere — including financialViabilityAnalysis, which builds the
// dimension-detail strings the Trident preview redactor has to strip, and
// projectionsXlsx, which renders a shipped Trident artifact.
export const REACT_SERVER_ONLY = new Set([
  // financialViabilityAnalysis.ts has `import "server-only"` — the package
  // throws unconditionally unless resolved with the `react-server` export
  // condition (see docs/archive/brokerage-sba-ready-v1/T1-AAR.md).
  "src/lib/feasibility/__tests__/financialViabilityAnalysis.test.ts",
  // projectionsXlsx.ts has `import "server-only"` — same class as above.
  "src/lib/brokerage/trident/__tests__/projectionsXlsx.test.ts",
  // Same class: imports geminiClient.ts, which has `import "server-only"`
  // (it reads GEMINI_API_KEY).
  "src/lib/ai/__tests__/streamGeminiText.test.ts",
  // Imports a module chain that pulls in "server-only".
  "src/core/nextStep/__tests__/computeNextStep.test.ts",
]);

// SPEC-CI-2 quarantine — files that cannot run under node --test at all.
// Empty: computeNextStep was the last entry. Its note claimed a harness
// failure, but under the react-server condition it imported cleanly and failed
// two assertions because both fixtures seeded an empty required checklist and
// so never reached the verify branch they were testing. The fixtures are fixed
// and the file now runs in CI via REACT_SERVER_ONLY above.
const QUARANTINE = new Set([]);

function isExcludedPath(rel) {
  if (rel.includes("node_modules")) return true;
  if (rel.includes("__invariants__")) return true;
  if (QUARANTINE.has(rel)) return true;
  if (REACT_SERVER_ONLY.has(rel)) return true;
  return false;
}

/**
 * Turn a real path into a pattern `node --test` can resolve.
 *
 * `?` matches any single character, so `?dealId?` matches the literal
 * `[dealId]`. Unlike the `[[]`/`[]]` glob-class form this replaced, it does
 * not collapse back to a bare `[dealId]` if something expands it on the way.
 */
export function toNodeTestPattern(rel) {
  return rel.replace(/[[\]]/g, "?");
}

/** A pattern is only safe if it selects exactly the file it came from. */
function patternRegex(pattern) {
  const escaped = pattern.replace(/[.*+^${}()|\\]/g, "\\$&").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Fail loudly if any wildcard is ambiguous or matches nothing. Silent
 * mis-selection is the failure mode this whole file exists to prevent.
 */
function assertPatternsResolve(files, patterns) {
  patterns.forEach((pattern, i) => {
    if (!pattern.includes("?")) return;
    const re = patternRegex(pattern);
    const matches = files.filter((f) => re.test(f));
    if (matches.length !== 1 || matches[0] !== files[i]) {
      console.error(
        `discover-tests: pattern "${pattern}" resolves to ${matches.length} discovered file(s) ` +
          `(${matches.join(", ") || "none"}); expected exactly ${files[i]}.`,
      );
      process.exit(1);
    }
  });
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

/**
 * The discovered REAL paths (not patterns). Exported so the runner and the
 * CI-honesty guard can work from the same list this file prints.
 */
export function discoverTestFiles({ reactServer = false } = {}) {
  const files = reactServer
    ? [...REACT_SERVER_ONLY]
        .filter((rel) => {
          // Fail loudly rather than silently dropping a renamed or deleted
          // entry. `node --test` with no positional args falls back to
          // scanning the whole tree, so an empty list here would quietly run
          // the entire suite under the react-server condition instead of
          // these few files.
          if (fs.existsSync(path.join(ROOT, rel))) return true;
          console.error(`discover-tests: REACT_SERVER_ONLY entry not found: ${rel}`);
          process.exit(1);
        })
        .sort()
    : SCAN_DIRS.flatMap((d) => walk(d))
        .map((f) => f.split(path.sep).join("/"))
        .filter((rel) => !isExcludedPath(rel))
        .sort();

  if (files.length === 0) {
    console.error(
      reactServer
        ? "discover-tests: react-server list is empty — refusing to emit nothing, which would make node --test scan the whole tree."
        : "discover-tests: no test files discovered.",
    );
    process.exit(1);
  }
  return files;
}

/** The patterns to hand to `node --test`, validated against the real list. */
export function discoverTestPatterns(opts) {
  const files = discoverTestFiles(opts);
  const patterns = files.map(toNodeTestPattern);
  assertPatternsResolve(files, patterns);
  return patterns;
}

// CLI. `--react-server` prints the react-server-condition list instead of the
// default one. NOTE: this output contains `?` wildcards — pass it through a
// shell-free spawn (scripts/run-unit-tests.mjs), never an unquoted `$(...)`,
// or the shell will expand the patterns before node can resolve them.
const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isCli) {
  const reactServer = process.argv.includes("--react-server");
  // `--paths` prints the REAL file paths instead of the node --test patterns.
  // Guards need both: the patterns to check what the runner receives, and the
  // paths to check those patterns each resolve to exactly one real file.
  const out = process.argv.includes("--paths")
    ? discoverTestFiles({ reactServer })
    : discoverTestPatterns({ reactServer });
  process.stdout.write(out.join("\n") + "\n");
}
