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
// Dynamic-segment paths (`[dealId]`, `[token]`) need care at the shell
// boundary. The old package script used unquoted command substitution, so the
// shell glob-expanded or discarded bracketed paths before Node received them.
// Seventeen dynamic-route test files silently contributed zero tests while the
// discovery guard still counted them (audit F-24).
//
// Node 20 treats positional test arguments as literal paths. The repair passes
// the real paths unchanged through scripts/run-unit-tests.mjs with shell:false.
// The execution guard runs a real dynamic-segment test and requires a non-zero
// test count, proving the file is executed rather than merely discovered.
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

/** Return the exact real path that Node's test runner must execute. */
export function toNodeTestPattern(rel) {
  return rel;
}

/** Fail loudly if discovery and execution arguments ever diverge. */
function assertPatternsResolve(files, patterns) {
  patterns.forEach((pattern, i) => {
    if (pattern !== files[i] || !fs.existsSync(path.join(ROOT, pattern))) {
      console.error(
        `discover-tests: execution path "${pattern}" does not resolve exactly to ${files[i]}.`,
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

// CLI. `--react-server` prints the react-server-condition list instead of
// the default one. Pass this output through the shell-free runner; never use
// unquoted command substitution for bracketed Next.js route paths.
const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isCli) {
  const reactServer = process.argv.includes("--react-server");
  // `--paths` remains a compatibility alias for the exact execution paths.
  const out = process.argv.includes("--paths")
    ? discoverTestFiles({ reactServer })
    : discoverTestPatterns({ reactServer });
  process.stdout.write(out.join("\n") + "\n");
}
