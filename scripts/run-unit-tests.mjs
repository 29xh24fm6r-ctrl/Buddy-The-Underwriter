// scripts/run-unit-tests.mjs
//
// Spawns `node --test` over the discovered unit-test files.
//
// This exists because the old package script used unquoted command substitution:
//   node --test --import tsx $(node scripts/discover-tests.mjs)
// The shell could glob-expand or discard Next.js dynamic-route paths such as
// `[token]` before Node received them. Node 20 accepts the real literal path;
// spawning with shell:false preserves it exactly and makes missing files fail.
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
