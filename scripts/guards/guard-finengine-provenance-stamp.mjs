#!/usr/bin/env node
/**
 * CI guard G2 — SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 Phase 0.
 *
 * "No writer of a canonical fact bypasses the provenance stamp (engine+version)."
 *
 * Phase 0 centralizes normalized provenance stamping in the single canonical
 * write chokepoint, `upsertDealFinancialFact` (src/lib/financialFacts/writeFact.ts),
 * which calls `stampProvenance` from src/lib/finengine/provenance.ts. This guard
 * enforces, structurally:
 *
 *   (A) The chokepoint still imports and invokes `stampProvenance` — so every
 *       write that flows through it carries engine + version.
 *   (B) No module under src/lib/finengine/** performs a RAW insert/upsert into
 *       `deal_financial_facts`. The new engine must always route through the
 *       stamping chokepoint, never bypass it.
 *
 * (The broader "single writer per core metric" invariant — retiring the legacy
 * direct writers — is guard G3, enforced at Phase 6. This guard is the Phase 0
 * provenance-coverage ratchet and must stay green from Phase 0 onward.)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const CHOKEPOINT = "src/lib/financialFacts/writeFact.ts";
const FINENGINE_ROOT = "src/lib/finengine";

const violations = [];

function read(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(e)) acc.push(full);
  }
  return acc;
}

// ---- (A) chokepoint stamps provenance ------------------------------------
let chokepoint = "";
try {
  chokepoint = read(CHOKEPOINT);
} catch {
  violations.push(`${CHOKEPOINT}: canonical write chokepoint is missing`);
}
if (chokepoint) {
  const imports = /import\s+\{[^}]*\bstampProvenance\b[^}]*\}\s+from\s+["']@\/lib\/finengine\/provenance["']/.test(chokepoint);
  const invokes = /stampProvenance\s*\(/.test(chokepoint);
  if (!imports) violations.push(`${CHOKEPOINT}: must import stampProvenance from @/lib/finengine/provenance`);
  if (!invokes) violations.push(`${CHOKEPOINT}: must invoke stampProvenance() before persisting the fact row`);
}

// ---- (B) no raw fact writes inside finengine -----------------------------
const finengineFiles = collectFiles(join(REPO_ROOT, FINENGINE_ROOT));
const RAW_WRITE = /from\(\s*["']deal_financial_facts["']\s*\)[\s\S]{0,400}?\.(insert|upsert)\s*\(/;
for (const file of finengineFiles) {
  const rel = relative(REPO_ROOT, file);
  if (rel.includes("__tests__")) continue;
  const content = readFileSync(file, "utf8");
  if (RAW_WRITE.test(content)) {
    violations.push(`${rel}: finengine module performs a raw insert/upsert into deal_financial_facts — route through upsertDealFinancialFact instead`);
  }
}

if (violations.length) {
  console.error("\n❌ guard-finengine-provenance-stamp (G2) failed:\n");
  for (const v of violations) console.error(` - ${v}`);
  console.error("");
  process.exit(1);
}
console.log("✅ guard-finengine-provenance-stamp (G2) passed.");
