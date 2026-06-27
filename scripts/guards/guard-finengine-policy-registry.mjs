#!/usr/bin/env node
/**
 * CI guard G1 — SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 Phase 1.
 *
 * "No computation file hardcodes a policy constant (DSCR floor / leverage limit /
 *  advance rate / occupancy threshold / stress parameter) — all via the registry."
 *  (NG4: policy lives only in src/lib/finengine/policyRegistry.ts.)
 *
 * Scans the finengine COMPUTATION surfaces (methods / metrics / sizing / sba /
 * collateral / riskRating / stress) for known policy magic-numbers. A file that
 * references such a constant must import from `policyRegistry` (i.e. it resolved
 * the value, not hardcoded it). Pure-plumbing files (contracts, provenance,
 * conflictLedger, factKeyRegistry, shadow, the registry itself, tests) are
 * exempt — they define or carry policy, they don't compute against a hardcoded
 * threshold.
 *
 * In Phase 1 the computation dirs don't exist yet, so this passes trivially; it
 * bites from Phase 2 onward when methods/metrics land.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const FINENGINE = join(REPO_ROOT, "src/lib/finengine");

// Files/dirs that legitimately carry policy or are pure plumbing.
const EXEMPT = [
  "policyRegistry.ts",
  "contracts.ts",
  "provenance.ts",
  "conflictLedger.ts",
  "factKeyRegistry.ts",
];
const EXEMPT_DIR_PARTS = ["__tests__", "shadow"];

// Policy magic-numbers that must come from the registry, not a literal.
const POLICY_LITERALS = [
  /\b1\.10\b/, /\b1\.15\b/, /\b1\.20\b/, /\b1\.25\b/, // DSCR/FCCR/current-ratio floors
  /\b0\.51\b/, /\b0\.60\b/,                            // 504 occupancy
  /\b0\.75\b/,                                          // LTV cap
  /\b4\.5\b/, /\b5\.0\b/,                               // leverage caps
  /\b300\s*bps\b/i, /\+\s*3\.0\b/,                      // rate shock
];

function collect(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXEMPT_DIR_PARTS.includes(e)) continue;
      collect(full, acc);
    } else if (/\.ts$/.test(e) && !EXEMPT.includes(e)) {
      acc.push(full);
    }
  }
  return acc;
}

const violations = [];
for (const file of collect(FINENGINE)) {
  const rel = relative(REPO_ROOT, file);
  const content = readFileSync(file, "utf8");
  const importsRegistry = /from\s+["']@\/lib\/finengine\/policyRegistry["']/.test(content);
  if (importsRegistry) continue; // resolved policy via the registry — OK
  for (const re of POLICY_LITERALS) {
    if (re.test(content)) {
      violations.push(`${rel}: hardcoded policy constant ${re} — resolve via policyRegistry instead (NG4)`);
      break;
    }
  }
}

if (violations.length) {
  console.error("\n❌ guard-finengine-policy-registry (G1) failed:\n");
  for (const v of violations) console.error(` - ${v}`);
  console.error("");
  process.exit(1);
}
console.log("✅ guard-finengine-policy-registry (G1) passed.");
