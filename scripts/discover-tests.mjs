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

// `--react-server` prints the react-server-condition list instead of the
// default list, so package.json can drive both runners from one discoverer.
const wantReactServer = process.argv.includes("--react-server");

const files = wantReactServer
  ? [...REACT_SERVER_ONLY]
      .filter((rel) => {
        // Fail loudly rather than silently dropping a renamed or deleted
        // entry. `node --test` with no positional args falls back to scanning
        // the whole tree, so an empty list here would quietly run the entire
        // suite under the react-server condition instead of these few files.
        if (fs.existsSync(path.join(ROOT, rel))) return true;
        console.error(`discover-tests: REACT_SERVER_ONLY entry not found: ${rel}`);
        process.exit(1);
      })
      .sort()
      .map(escapeForNodeTestGlob)
  : SCAN_DIRS.flatMap((d) => walk(d))
      .map((f) => f.split(path.sep).join("/"))
      .filter((rel) => !isExcludedPath(rel))
      .sort()
      .map(escapeForNodeTestGlob);

if (files.length === 0) {
  console.error(
    wantReactServer
      ? "discover-tests: react-server list is empty — refusing to emit nothing, which would make node --test scan the whole tree."
      : "discover-tests: no test files discovered.",
  );
  process.exit(1);
}

process.stdout.write(files.join("\n") + "\n");
