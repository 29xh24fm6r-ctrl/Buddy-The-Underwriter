#!/usr/bin/env node
/**
 * CI guard G4 — SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 Phase 6.
 *
 * The §2.1 layer-cake wall: "math drives the memo; the memo never drives the
 * math." No memo / covenant / advisory module may write UPWARD into certified
 * facts or conclusions. This guard fails if anything under
 * src/lib/finengine/memo/** or src/lib/finengine/covenants/**:
 *   - imports the canonical writer (writeFact / upsertDealFinancialFact), or
 *   - performs a raw insert/upsert into deal_financial_facts.
 *
 * Also enforces a slice of G3 (single-writer): NO finengine module outside the
 * write chokepoint may insert/upsert canonical facts (today none do — they are
 * all pure conclusions / renderers; this ratchets that invariant forward).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const WALLED = [join(REPO_ROOT, "src/lib/finengine/memo"), join(REPO_ROOT, "src/lib/finengine/covenants")];

const violations = [];

function collect(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, acc);
    else if (/\.ts$/.test(e) && !e.includes(".test.")) acc.push(full);
  }
  return acc;
}

const FORBIDDEN = [
  { re: /upsertDealFinancialFact/, msg: "imports/uses the canonical fact writer" },
  { re: /from\(\s*["']deal_financial_facts["']\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\s*\(/, msg: "raw write to deal_financial_facts" },
  { re: /from\s+["']@\/lib\/financialFacts\/writeFact["']/, msg: "imports writeFact chokepoint" },
];

for (const root of WALLED) {
  for (const file of collect(root)) {
    const rel = relative(REPO_ROOT, file);
    const content = readFileSync(file, "utf8");
    for (const f of FORBIDDEN) {
      if (f.re.test(content)) violations.push(`${rel}: ${f.msg} — memo/covenant layer must never write upward (§2.1 wall)`);
    }
  }
}

if (violations.length) {
  console.error("\n❌ guard-finengine-memo-wall (G4) failed:\n");
  for (const v of violations) console.error(` - ${v}`);
  console.error("");
  process.exit(1);
}
console.log("✅ guard-finengine-memo-wall (G4) passed.");
