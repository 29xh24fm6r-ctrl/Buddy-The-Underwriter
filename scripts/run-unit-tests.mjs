// scripts/run-unit-tests.mjs
//
// Runs the discovered unit tests through node:test's programmatic run() API.
//
// Why not `node --test <paths...>`: that form's meaning changed between the
// Node CI runs (20, per .nvmrc and ci.yml) and the Node the package declares
// (22, per engines.node).
//
//   form              Node 20                  Node 22
//   [dealId] literal  runs the file            globs to nothing -> "0 tests"
//   ?dealId? wildcard "Could not find"         runs the file
//
// Node 20 does not glob positional arguments; Node 22 does. No single string
// form works on both, so every fix attempted at the string level moved the
// breakage rather than removing it — and the silent direction (Node 22
// reporting "0 tests, 0 fail") is the dangerous one, because it looks green.
//
// run({ files }) takes literal paths and applies no glob semantics on any
// version. Verified identical on Node 20 and Node 22 against paths containing
// both `[dealId]` and `(app)`.
//
// The child processes inherit this process's execArgv, which is how `tsx` and
// `--conditions=react-server` reach them — hence package.json invokes this as
// `node --import tsx scripts/run-unit-tests.mjs`.
//
// This supersedes a spawnSync(..., { shell: false }) version that passed the
// literal paths to `node --test`. That preserved argv exactly, which is what
// Node 20 needs — measured 13187 tests, 0 fail on Node 20 — but on Node 22 it
// measured 13104 tests with the 17 dynamic-segment files silently absent.
// Preserving argv is necessary and not sufficient: the remaining divergence
// is inside node --test's own argument handling, which only run({ files })
// avoids.
//
// Usage: node --import tsx scripts/run-unit-tests.mjs [--react-server]
import { run } from "node:test";
import { tap } from "node:test/reporters";
import process from "node:process";
import { discoverTestFiles } from "./discover-tests.mjs";

const reactServer = process.argv.includes("--react-server");

// `--files-probe` runs ONLY the discovered test files that live under a
// Next.js dynamic-segment directory. Those are the files whose execution
// depends on how the running Node interprets `[dealId]`, so a guard can call
// this to prove they actually run on whichever Node is executing, rather than
// inspecting path strings that look correct on both versions.
const filesProbe = process.argv.includes("--files-probe");

const discovered = discoverTestFiles({ reactServer });
const files = filesProbe
  ? discovered.filter((f) => /[[\]]/.test(f))
  : discovered;

if (filesProbe && files.length === 0) {
  console.error("run-unit-tests: --files-probe matched no dynamic-segment test files.");
  process.exit(1);
}

let failures = 0;
const stream = run({ files, concurrency: true });
stream.on("test:fail", (event) => {
  // Suites report a failure for each failing child; counting only leaf
  // failures would still be nonzero, but counting all of them keeps the exit
  // code honest without needing to model the tree.
  if (event?.todo || event?.skip) return;
  failures += 1;
});

stream.compose(tap).pipe(process.stdout);

stream.on("end", () => {
  if (files.length === 0) {
    console.error("run-unit-tests: no test files discovered — refusing to report success.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = failures > 0 ? 1 : 0;
});
