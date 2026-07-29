#!/usr/bin/env node
/**
 * CI guard — SPEC-SYSTEM-DEBLOAT-1 Phase D (lib dedup).
 *
 * Same shape as guard-finengine-legacy-imports.mjs: once a duplicate
 * src/lib/<concept> pair is merged into one canonical module, the losing
 * path is retired and this guard fails CI if anything imports it again —
 * whether by an old branch rebasing in a stale import, or someone typing
 * the retired name out of muscle memory.
 *
 * Retired-paths list is append-only (scripts/guards/lib-legacy-dirs-retired.txt).
 * Matches both static `from "@/lib/<retired>"` and dynamic `import("@/lib/<retired>")`,
 * for both a bare-file retirement ("@/lib/ai-events") and a directory retirement
 * ("@/lib/checklist" retiring the whole dir, including "@/lib/checklist/foo").
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.env.LIB_LEGACY_REPO_ROOT || process.cwd();
const SCAN_DIRS = process.env.LIB_LEGACY_SCAN_DIRS
  ? process.env.LIB_LEGACY_SCAN_DIRS.split(",")
  : ["src", "services", "scripts"];
const RETIRED_PATH = process.env.LIB_LEGACY_RETIRED_LIST
  || join(REPO_ROOT, "scripts/guards/lib-legacy-dirs-retired.txt");

const retired = readFileSync(RETIRED_PATH, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

function collect(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "__tests__") continue;
      collect(full, acc);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e)) {
      acc.push(full);
    }
  }
  return acc;
}

// Matches `from "@/lib/<retired>"`, `from "@/lib/<retired>/..."`, and the
// dynamic-import equivalent. Word-boundaried on the retired segment so
// "@/lib/ai-events" doesn't also match "@/lib/ai-events-v2" (a different,
// non-retired module).
const patterns = retired.map((r) => ({
  name: r,
  re: new RegExp(
    String.raw`(?:from\s+|import\()\s*["']@/lib/${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^"']*)?["']`,
  ),
}));

const offenders = [];
for (const dir of SCAN_DIRS) {
  for (const file of collect(join(REPO_ROOT, dir))) {
    const rel = relative(REPO_ROOT, file);
    const content = readFileSync(file, "utf8");
    for (const { name, re } of patterns) {
      if (re.test(content)) {
        offenders.push({ file: rel, retired: name });
      }
    }
  }
}

if (offenders.length) {
  console.error("\n❌ Import(s) from a retired @/lib path (SPEC-SYSTEM-DEBLOAT-1 Phase D):\n");
  for (const o of offenders) console.error(` - ${o.file}  →  @/lib/${o.retired}`);
  console.error(
    "\nThe canonical module replaced this path. Check " +
      "scripts/guards/lib-legacy-dirs-retired.txt for what to import instead " +
      "(or see the merge PR referenced in its history).\n",
  );
  process.exit(1);
}

console.log(`✅ guard-lib-legacy-dirs passed (${retired.length} retired path(s), 0 offending imports).`);
