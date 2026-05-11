/**
 * SPEC-FOUNDATION-V1 PR5g — Within-job GLOBAL_CASH_FLOW re-render guards.
 *
 * Verifies the second renderSpread call exists, is correctly placed,
 * and is properly guarded.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SP_PATH = join(REPO_ROOT, "src/lib/jobs/processors/spreadsProcessor.ts");

function read(): string {
  return readFileSync(SP_PATH, "utf8");
}

// ── Existence guard ────────────────────────────────────────────────────────

test("[pr5g-1] spreadsProcessor has a second renderSpread call for GLOBAL_CASH_FLOW", () => {
  const body = read();
  assert.match(
    body,
    /renderSpreadAgain/,
    "spreadsProcessor must import renderSpread as renderSpreadAgain for the second render.",
  );
  assert.match(
    body,
    /canonical\.recompute\.spread_rerendered/,
    "spreadsProcessor must emit canonical.recompute.spread_rerendered event.",
  );
});

// ── Placement guard ────────────────────────────────────────────────────────

test("[pr5g-2] second render is AFTER persistGlobalCashFlow", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const gcfIdx = stripped.indexOf("persistGlobalCashFlow(");
  const rerenderIdx = stripped.indexOf("renderSpreadAgain(");
  assert.ok(gcfIdx > 0, "persistGlobalCashFlow call not found");
  assert.ok(rerenderIdx > gcfIdx, "renderSpreadAgain must come AFTER persistGlobalCashFlow");
});

test("[pr5g-3] second render is BEFORE triggerCanonicalRecompute", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const rerenderIdx = stripped.indexOf("renderSpreadAgain(");
  const triggerIdx = stripped.indexOf("triggerCanonicalRecompute(");
  assert.ok(rerenderIdx > 0, "renderSpreadAgain call not found");
  assert.ok(triggerIdx > rerenderIdx, "renderSpreadAgain must come BEFORE triggerCanonicalRecompute");
});

// ── Guard check ────────────────────────────────────────────────────────────

test("[pr5g-4] second render is guarded by completedTypes.has(GLOBAL_CASH_FLOW)", () => {
  const body = read();
  // Find renderSpreadAgain and search backwards for the guard
  const rerenderIdx = body.indexOf("renderSpreadAgain(");
  assert.ok(rerenderIdx > 0);
  const preceding = body.slice(Math.max(0, rerenderIdx - 500), rerenderIdx);
  assert.ok(
    preceding.includes('completedTypes.has("GLOBAL_CASH_FLOW"') ||
    preceding.includes("completedTypes.has('GLOBAL_CASH_FLOW'"),
    "Second render must be guarded by completedTypes.has(GLOBAL_CASH_FLOW).",
  );
});

// ── Non-fatal guard ────────────────────────────────────────────────────────

test("[pr5g-5] second render is wrapped in try/catch (non-fatal)", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const rerenderIdx = stripped.indexOf("renderSpreadAgain(");
  assert.ok(rerenderIdx > 0);
  const preceding = stripped.slice(Math.max(0, rerenderIdx - 300), rerenderIdx);
  assert.ok(
    preceding.includes("try {") || preceding.includes("try{"),
    "renderSpreadAgain must be inside a try block.",
  );
  const following = stripped.slice(rerenderIdx, rerenderIdx + 2000);
  assert.ok(
    following.includes("catch"),
    "Try block containing renderSpreadAgain must have a catch clause.",
  );
});

// ── Ledger event guard ─────────────────────────────────────────────────────

test("[pr5g-6] spread_rerendered event includes triggerReason", () => {
  const body = read();
  const stripped = body.replace(/\/\/.*$/gm, "");
  const eventIdx = stripped.indexOf("canonical.recompute.spread_rerendered");
  assert.ok(eventIdx > 0, "spread_rerendered event not found");
  const context = stripped.slice(eventIdx, eventIdx + 500);
  assert.match(context, /triggerReason/, "spread_rerendered must include triggerReason in meta.");
});

test("[pr5g-7] spread_rerendered event includes renderPass: 2", () => {
  const body = read();
  const eventIdx = body.indexOf("canonical.recompute.spread_rerendered");
  assert.ok(eventIdx > 0);
  const context = body.slice(eventIdx, eventIdx + 500);
  assert.match(context, /renderPass:\s*2/, "spread_rerendered must indicate renderPass: 2.");
});

test("[pr5g-8] spread_rerendered event includes timing notes", () => {
  const body = read();
  assert.match(
    body,
    /rendered_after_canonical_chain/,
    "spread_rerendered must include 'rendered_after_canonical_chain' note.",
  );
  assert.match(
    body,
    /facts_now_current/,
    "spread_rerendered must include 'facts_now_current' note.",
  );
});

// ── CAS bypass documentation ───────────────────────────────────────────────

test("[pr5g-9] code documents CAS bypass rationale", () => {
  const body = read();
  // The comment block should explain why CAS is bypassed
  assert.match(
    body,
    /CAS.*claim.*flow|bypass.*CAS|CAS.*protect/i,
    "Code must document why the second render bypasses CAS.",
  );
});
