#!/usr/bin/env tsx
/**
 * Route Budget Guard
 *
 * Counts route.ts + page.tsx files under src/app and fails if the count
 * exceeds the budget. Prevents Vercel route-cap failures (2048 limit)
 * from reaching production.
 *
 * Usage: npx tsx scripts/check-routes.ts
 *    or: npm run check:routes
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WARN_THRESHOLD = 900;
const FAIL_THRESHOLD = 925;
const APP_ROOT = join(process.cwd(), "src/app");
const TOP_N = 10;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
      out.push(...walk(full));
    } else if (entry.isFile() && (entry.name === "route.ts" || entry.name === "page.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(APP_ROOT);
const total = files.length;

// Count per top-level directory under src/app
const dirCounts = new Map<string, number>();
for (const f of files) {
  const rel = relative(APP_ROOT, f);
  const top = rel.split("/").slice(0, 2).join("/");
  dirCounts.set(top, (dirCounts.get(top) ?? 0) + 1);
}

const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N);

console.log(`\n  Route Budget Guard\n`);
console.log(`  Total route/page files: ${total}`);
console.log(`  Warn threshold:         ${WARN_THRESHOLD}`);
console.log(`  Fail threshold:         ${FAIL_THRESHOLD}`);
console.log(`  Budget remaining:       ${FAIL_THRESHOLD - total}`);
console.log(`\n  Top ${TOP_N} directories:\n`);
for (const [dir, count] of sorted) {
  console.log(`    ${String(count).padStart(4)}  ${dir}`);
}
console.log();

if (total >= FAIL_THRESHOLD) {
  console.error(`  FAIL: ${total} route files >= ${FAIL_THRESHOLD} budget limit.`);
  console.error(`  Remove dead routes before merging.\n`);
  process.exit(1);
} else if (total >= WARN_THRESHOLD) {
  console.warn(`  WARN: ${total} route files >= ${WARN_THRESHOLD} warning threshold.`);
  console.warn(`  Consider pruning unused routes soon.\n`);
} else {
  console.log(`  OK: ${total} route files within budget.\n`);
}
