/**
 * SPEC-COMMITTEE-READY-FLOW-1 CI Guards
 *
 * Covers the four fixes:
 *   Fix 1 — decision page auto-generates a snapshot on first visit
 *   Fix 2 — nextAction.committee_ready routes to /decision (not /credit-memo)
 *   Fix 3 — /credit/committee renders a native page over real deals
 *   Fix 4A — writeFactsBatch caps fact periodEnd to documentPeriodEnd
 *   Fix 4B — detectPeriods builds spine from tax-return periods first
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");
function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

// ── Fix 2: nextAction committee_ready routes to /decision ────────────────────

test("Fix 2: nextAction committee_ready label is 'Record Decision' and href is /deals/[id]/decision", () => {
  const src = read("src/buddy/lifecycle/nextAction.ts");
  assert.match(
    src,
    /case "committee_ready":[\s\S]{0,400}?label:\s*"Record Decision"/,
    "committee_ready must return label 'Record Decision'",
  );
  assert.match(
    src,
    /case "committee_ready":[\s\S]{0,500}?href:\s*`\/deals\/\$\{dealId\}\/decision`/,
    "committee_ready must href to /deals/[id]/decision",
  );
  assert.doesNotMatch(
    src,
    /case "committee_ready":[\s\S]{0,500}?\/credit-memo/,
    "committee_ready must no longer route to /credit-memo (was: SPEC-COMMITTEE-READY-FLOW-1 Fix 2)",
  );
});

// ── Fix 1: decision page auto-generates snapshot instead of redirecting ──────

test("Fix 1: decision page calls generateDecisionSnapshot and no longer redirects when snapshot is null", () => {
  const src = read("src/app/(app)/deals/[dealId]/decision/page.tsx");
  assert.match(
    src,
    /import \{ generateDecisionSnapshot \} from "@\/lib\/decision\/generateDecisionSnapshot"/,
    "must import generateDecisionSnapshot",
  );
  assert.match(
    src,
    /import \{ DecisionStartPage \} from "@\/components\/decision\/DecisionStartPage"/,
    "must import DecisionStartPage fallback UI",
  );
  assert.match(
    src,
    /generateDecisionSnapshot\(\{ dealId, bankId, sb \}\)/,
    "must call generateDecisionSnapshot with deal+bank+sb",
  );
  assert.doesNotMatch(
    src,
    /if \(!snapshot\) \{\s*redirect\(`\/deals\/\$\{dealId\}`\);\s*\}/,
    "must no longer redirect to /deals/[id] when snapshot is null (the bug fix)",
  );
});

test("Fix 1: generateDecisionSnapshot reads dscr.value_num from financial_snapshots and inserts proposed status", () => {
  const src = read("src/lib/decision/generateDecisionSnapshot.ts");
  assert.match(src, /import "server-only"/, "must be server-only");
  assert.match(
    src,
    /\.from\("financial_snapshots"\)/,
    "must query financial_snapshots (v1) — the table the recompute route writes to",
  );
  assert.match(
    src,
    /snap\?\.dscr\?\.value_num/,
    "must read dscr.value_num from snapshot_json",
  );
  assert.match(
    src,
    /status:\s*"proposed"/,
    "inserted snapshot must start at status='proposed' — banker promotes it",
  );
});

// ── Fix 3: /credit/committee is a native page, not a Stitch iframe ───────────

test("Fix 3: /credit/committee no longer renders StitchSurface; queries deals natively", () => {
  const src = read("src/app/(app)/credit/committee/page.tsx");
  assert.doesNotMatch(
    src,
    /StitchSurface/,
    "Stitch iframe was the source of fixture 'Project Atlas' data — must be removed",
  );
  assert.match(
    src,
    /\.from\("deals"\)/,
    "must query the deals table directly",
  );
  assert.match(
    src,
    /\.eq\("bank_id", bankId\)/,
    "must scope deals query to current bank",
  );
  assert.match(
    src,
    /\.in\(\s*"lifecycle_stage"/,
    "must filter deals by lifecycle_stage",
  );
  assert.match(
    src,
    /committee_ready/,
    "must include committee_ready as a target stage",
  );
});

// ── Fix 4 Part A: writeFactsBatch caps periodEnd to documentPeriodEnd ────────

test("Fix 4A: writeFactsBatch supports documentPeriodEnd and capItemsToDocumentPeriod caps overshooting periods", () => {
  const src = read("src/lib/financialSpreads/extractors/shared.ts");
  assert.match(
    src,
    /documentPeriodEnd\?:\s*string \| null/,
    "writeFactsBatch must accept an optional documentPeriodEnd parameter",
  );
  assert.match(
    src,
    /export function capItemsToDocumentPeriod\(/,
    "capItemsToDocumentPeriod must be exported for direct use and tests",
  );
  // The cap logic itself: items with periodEnd > documentPeriodEnd get
  // rewritten to documentPeriodEnd; everything else passes through.
  assert.match(
    src,
    /if \(item\.periodEnd <= documentPeriodEnd\) return item;\s*return \{ \.\.\.item, periodEnd: documentPeriodEnd \};/,
    "cap helper must rewrite only items that exceed documentPeriodEnd",
  );
  // Null documentPeriodEnd is a no-op (cannot validate against an
  // unknown period — must not silently destroy correct dates).
  assert.match(
    src,
    /if \(!documentPeriodEnd \|\| !\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(documentPeriodEnd\)\) \{\s*return items;\s*\}/,
    "null/invalid documentPeriodEnd must short-circuit (no cap applied)",
  );
});

// ── Fix 4 Part B: detectPeriods builds spine from tax-return periods first ───

test("Fix 4B: detectPeriods comment + logic uses FULL_YEAR_FACT_TYPES to pick tax-return spine", () => {
  const src = read("src/lib/financialSpreads/standard/renderStandardSpread.ts");
  assert.match(
    src,
    /SPEC-COMMITTEE-READY-FLOW-1 — Fix 4 Part B/,
    "implementation must reference this spec",
  );
  assert.match(
    src,
    /FULL_YEAR_FACT_TYPES\.has\(t\)/,
    "tax-return spine must be selected via FULL_YEAR_FACT_TYPES",
  );
  assert.match(
    src,
    /taxReturnYears\.has\(pe\.slice\(0, 4\)\)/,
    "non-tax periods sharing a year with a tax-return period must be excluded",
  );
});
