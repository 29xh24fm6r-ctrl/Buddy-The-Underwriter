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
//   - paths containing `(` or `[` — Next route-group / dynamic-segment dirs. node
//     --test cannot resolve these (runs 0 tests silently, memory #30); they are
//     unreachable-by-runner regardless of glob. A separate structural fix is needed.
//   - __invariants__ — owned by the `test:invariants` runner, not test:unit.
//   - QUARANTINE — individually named files that cannot run under node --test
//     (import errors). Each carries a SPEC-CI-2 reason and is inventoried in
//     specs/ci-2/backlog.md. This list is remove-only.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.DISCOVER_ROOT || process.cwd();
const SCAN_DIRS = ["src", "scripts"];

// SPEC-CI-2 quarantine — files that error at import time under node --test.
const QUARANTINE = new Set([
  // Imports a module chain that pulls in "server-only" (not resolvable under
  // node --test → "Cannot find module 'server-only'"). Class C harness issue.
  "src/core/nextStep/__tests__/computeNextStep.test.ts",
]);

function isExcludedPath(rel) {
  if (rel.includes("node_modules")) return true;
  if (rel.includes("(") || rel.includes("[")) return true; // unreachable-by-runner
  if (rel.includes("__invariants__")) return true;
  if (QUARANTINE.has(rel)) return true;
  return false;
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
  .sort();

process.stdout.write(files.join("\n") + "\n");
