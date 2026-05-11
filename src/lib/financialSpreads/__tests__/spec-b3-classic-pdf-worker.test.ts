/**
 * SPEC-B3 — Classic PDF Worker source-level guards + type system tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── V-1: CLASSIC_PDF is in the SpreadType union and ALL_SPREAD_TYPES ──────

test("[spec-b3-v1] SpreadType union includes CLASSIC_PDF", () => {
  const body = read("src/lib/financialSpreads/types.ts");
  assert.match(body, /"CLASSIC_PDF"/, "SpreadType must include CLASSIC_PDF");
});

test("[spec-b3-v2] ALL_SPREAD_TYPES includes CLASSIC_PDF", () => {
  const { ALL_SPREAD_TYPES } = require("@/lib/financialSpreads/types");
  assert.ok(
    ALL_SPREAD_TYPES.includes("CLASSIC_PDF"),
    "ALL_SPREAD_TYPES must include CLASSIC_PDF",
  );
});

// ── V-3: classicPdfWorker exists and exports correctly ────────────────────

test("[spec-b3-v3] classicPdfWorker exports renderClassicPdfSpread", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  assert.match(body, /export async function renderClassicPdfSpread/, "Must export renderClassicPdfSpread");
});

test("[spec-b3-v4] classicPdfWorker uses same render pipeline as sync route", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  assert.match(body, /loadClassicSpreadData/, "Must use loadClassicSpreadData");
  assert.match(body, /renderClassicSpread/, "Must use renderClassicSpread");
  assert.match(body, /preflightClassicSpread/, "Must run preflight check");
  assert.match(body, /generateSpreadNarrative/, "Must attempt narrative generation");
});

test("[spec-b3-v5] classicPdfWorker computes pdf_sha256 for verification", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  assert.match(body, /createHash.*sha256/, "Must compute SHA-256 hash of PDF");
  assert.match(body, /pdf_sha256/, "Must include pdf_sha256 in result");
});

test("[spec-b3-v6] classicPdfWorker includes canonicalFactsTimestamp", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  assert.match(body, /canonicalFactsTimestamp/, "Must include canonicalFactsTimestamp for staleness check");
});

test("[spec-b3-v7] classicPdfWorker persists to deal_spreads with onConflict", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  assert.match(body, /upsert/, "Must use upsert (not insert) to deal_spreads");
  assert.match(body, /onConflict/, "Must use onConflict for idempotent upsert");
  assert.match(body, /CLASSIC_PDF/, "Must use CLASSIC_PDF spread type");
  assert.match(body, /SENTINEL_UUID/, "Must use SENTINEL_UUID for owner_entity_id");
});

test("[spec-b3-v8] classicPdfWorker uses PDFKit (not Playwright)", () => {
  const body = read("src/lib/classicSpread/classicPdfWorker.ts");
  // Worker imports renderClassicSpread which uses PDFKit
  assert.ok(!body.includes("playwright"), "Must not import playwright");
  assert.ok(!body.includes("chromium"), "Must not reference chromium");
});

// ── V-9: spreadsProcessor dispatches CLASSIC_PDF to classicPdfWorker ──────

test("[spec-b3-v9] spreadsProcessor has CLASSIC_PDF dispatch before template check", () => {
  const body = read("src/lib/jobs/processors/spreadsProcessor.ts");
  const classicIdx = body.indexOf('spreadType === "CLASSIC_PDF"');
  assert.ok(classicIdx > 0, "Processor must check for CLASSIC_PDF");

  const templateIdx = body.indexOf("getSpreadTemplate(spreadType)", classicIdx);
  assert.ok(templateIdx > classicIdx, "CLASSIC_PDF dispatch must come before template check");

  // Confirm it imports the worker
  const nearby = body.slice(classicIdx, classicIdx + 500);
  assert.match(nearby, /classicPdfWorker/, "Must import classicPdfWorker");
  assert.match(nearby, /renderClassicPdfSpread/, "Must call renderClassicPdfSpread");
});

// ── V-10: template registry has CLASSIC_PDF ────────────────────────────────

test("[spec-b3-v10] getSpreadTemplate returns a template for CLASSIC_PDF", () => {
  const body = read("src/lib/financialSpreads/templates/index.ts");
  assert.match(body, /CLASSIC_PDF/, "Template registry must handle CLASSIC_PDF");
  assert.match(body, /classicPdfTemplate/, "Must have classicPdfTemplate function");
});

test("[spec-b3-v11] CLASSIC_PDF template render throws (not template-based)", () => {
  const body = read("src/lib/financialSpreads/templates/index.ts");
  // Find the classicPdfTemplate function and verify render throws
  const tplIdx = body.indexOf("function classicPdfTemplate");
  assert.ok(tplIdx > 0, "classicPdfTemplate must exist");
  const tplBlock = body.slice(tplIdx, tplIdx + 500);
  assert.match(tplBlock, /throw new Error/, "CLASSIC_PDF template render must throw");
});

// ── V-12: triggerCanonicalRecompute enqueues CLASSIC_PDF separately ────────

test("[spec-b3-v12] triggerCanonicalRecompute enqueues CLASSIC_PDF as separate job", () => {
  const body = read("src/lib/financialFacts/triggerCanonicalRecompute.ts");
  // Find the CLASSIC_PDF enqueue — must be a SEPARATE enqueueSpreadRecompute call
  const classicIdx = body.indexOf("CLASSIC_PDF");
  assert.ok(classicIdx > 0, "Must reference CLASSIC_PDF");

  // Must be in a separate try/catch block from the main enqueue
  const nearbyBlock = body.slice(Math.max(0, classicIdx - 300), classicIdx + 800);
  assert.match(nearbyBlock, /try/, "CLASSIC_PDF enqueue must be in its own try block");
  assert.match(nearbyBlock, /non-fatal/, "CLASSIC_PDF enqueue failure must be non-fatal");
});

// ── V-13: lifecycle stage-transition hook ──────────────────────────────────

test("[spec-b3-v13] advanceDealLifecycle enqueues CLASSIC_PDF on underwriting stages", () => {
  const body = read("src/buddy/lifecycle/advanceDealLifecycle.ts");
  assert.match(body, /CLASSIC_PDF/, "Must reference CLASSIC_PDF");
  assert.match(body, /underwrite_in_progress/, "Must trigger on underwrite_in_progress");
  assert.match(body, /committee_ready/, "Must trigger on committee_ready");
  assert.match(body, /enqueueClassicPdfPreRender/, "Must have enqueueClassicPdfPreRender helper");
});

// ── V-14: cache shim on legacy route ───────────────────────────────────────

test("[spec-b3-v14] legacy classic-spread route persists PDF to deal_spreads cache", () => {
  const body = read("src/app/api/deals/[dealId]/classic-spread/route.ts");
  assert.match(body, /CLASSIC_PDF/, "Legacy route must reference CLASSIC_PDF");
  assert.match(body, /pdf_base64/, "Legacy route must persist pdf_base64");
  assert.match(body, /pdf_sha256/, "Legacy route must persist pdf_sha256");
  assert.match(body, /upsert/, "Legacy route must upsert to deal_spreads");
  assert.match(body, /cache shim/, "Legacy route must have cache shim comment");
});
