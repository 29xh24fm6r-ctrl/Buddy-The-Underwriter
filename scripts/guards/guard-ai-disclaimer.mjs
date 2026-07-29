#!/usr/bin/env node
// scripts/guards/guard-ai-disclaimer.mjs
// SPEC-M1 AI-GATEWAY-1, Program Invariant #2 — one disclaimer source, no
// retyped copies.
//
// Convention: any file that renders AI-generated/AI-narrated content to a
// borrower, banker, or lender marks itself with a comment
//   // ai-disclaimer-surface: readiness | memo | fix_card | interview
// (same marker-comment convention as guard-deal-route-access.mjs's
// `// route-class: ...`). Any file carrying that marker MUST import from
// src/lib/ai/disclaimers.ts — either the specific exported constant or
// getDisclaimer(). No such surface exists yet as of SPEC-M1 (M3+ owns the
// actual rendering); this guard exists now so M3's Glass Box and every
// later surface are enforced from day one, not bolted on after the fact.
//
// Env overrides (used by this guard's own fixture tests):
//   AI_DISCLAIMER_GUARD_BASE   repo root for relative-path identity (cwd)
//   AI_DISCLAIMER_GUARD_ROOT   directory to scan

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AI_DISCLAIMER_GUARD_BASE || process.cwd();
const SCAN_ROOT = process.env.AI_DISCLAIMER_GUARD_ROOT || path.join(BASE, "src");

const SURFACE_MARKER_RE = /\/\/\s*ai-disclaimer-surface:\s*(readiness|memo|fix_card|interview)/;
const DISCLAIMER_IMPORT_RE = /from\s+["']@\/lib\/ai\/disclaimers["']/;

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relId(absFile) {
  return path.relative(BASE, absFile).split(path.sep).join("/");
}

function main() {
  const files = walkFiles(SCAN_ROOT);
  const violations = [];
  let markedCount = 0;

  for (const abs of files) {
    const content = fs.readFileSync(abs, "utf8");
    if (!SURFACE_MARKER_RE.test(content)) continue;
    markedCount++;
    if (!DISCLAIMER_IMPORT_RE.test(content)) {
      violations.push(relId(abs));
    }
  }

  if (violations.length === 0) {
    console.log(
      `✅ ai-disclaimer guard passed (${files.length} files scanned; ` +
        `${markedCount} marked ai-disclaimer-surface, all import disclaimers.ts).`,
    );
    return;
  }

  console.error(
    "\n❌ file(s) marked `// ai-disclaimer-surface: ...` but do not import " +
      "src/lib/ai/disclaimers.ts:\n",
  );
  for (const f of violations) console.error(` - ${f}`);
  console.error(
    '\nFix: import getDisclaimer() (or the specific constant) from ' +
      '"@/lib/ai/disclaimers" rather than retyping the disclaimer copy.\n',
  );
  process.exit(1);
}

main();
