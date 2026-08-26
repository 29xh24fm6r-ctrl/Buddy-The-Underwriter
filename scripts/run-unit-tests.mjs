// scripts/run-unit-tests.mjs
//
// Spawns `node --test` over the discovered unit-test files.
//
// This exists because of the shell. package.json used to run
//   node --test --import tsx $(node scripts/discover-tests.mjs)
// and the unquoted command substitution meant the shell word-split AND
// glob-expanded the discoverer's output before node saw it. Dynamic-segment
// paths are emitted with node-glob bracket escapes (`[[]token[]]`) so node's own glob
// matching can resolve the literal brackets — but a shell expands those
// patterns first, handing node the bare `[token]` it cannot resolve, and node
// reports "0 tests" for them without failing. Seventeen files were dead that
// way (audit F-24).
//
// Spawning with shell:false removes that layer entirely: the escapes reach
// node exactly as written.
//
// Usage: node scripts/run-unit-tests.mjs [--react-server]
import { spawnSync } from "node:child_process";
import { discoverTestPatterns } from "./discover-tests.mjs";

const reactServer = process.argv.includes("--react-server");
const patterns = discoverTestPatterns({ reactServer });

const nodeArgs = [
  ...(reactServer ? ["--conditions=react-server"] : []),
  "--test",
  "--import",
  "tsx",
  ...patterns,
];

const result = spawnSync(process.execPath, nodeArgs, {
  stdio: "inherit",
  shell: false, // load-bearing — see the header.
});

if (result.error) {
  console.error("run-unit-tests: failed to spawn node --test:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
