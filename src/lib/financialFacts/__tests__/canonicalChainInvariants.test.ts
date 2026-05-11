/**
 * SPEC-FOUNDATION-V1 PR5i — Canonical chain invariant + writer hardening tests.
 *
 * Eight source-level guards verifying the hardening deliverables.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const REGISTRY_PATH = join(REPO_ROOT, "src/lib/financialFacts/canonicalWriters.ts");
const INVARIANTS_PATH = join(REPO_ROOT, "src/lib/financialFacts/assertCanonicalChainInvariants.ts");
const SP_PATH = join(REPO_ROOT, "src/lib/jobs/processors/spreadsProcessor.ts");
const TDS_PATH = join(REPO_ROOT, "src/lib/structuralPricing/computeTotalDebtService.ts");
const BACKFILL_PATH = join(REPO_ROOT, "src/lib/financialFacts/backfillFromSpreads.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// ── Test 1: Registry exists with all five writers ──────────────────────────

test("[pr5i-1] canonicalWriters.ts has all five writer entries", () => {
  const body = read(REGISTRY_PATH);
  for (const writer of [
    "runCashFlowAggregator",
    "backfillCanonicalFactsFromSpreads",
    "computeTotalDebtService",
    "persistGlobalCashFlow",
    "persistGcfComputedFacts",
  ]) {
    assert.match(
      body,
      new RegExp(`${writer}:\\s*\\{`),
      `Registry must contain entry for ${writer}.`,
    );
  }
  // All marked loadBearing
  const matches = body.match(/loadBearing:\s*true/g) ?? [];
  assert.ok(
    matches.length >= 5,
    `All five writers must be loadBearing: true. Found ${matches.length}.`,
  );
});

// ── Test 2: Aggregator comment block with DO NOT REMOVE sentinel ───────────

test("[pr5i-2] spreadsProcessor has BOOTSTRAP-WRITER-DO-NOT-REMOVE sentinel", () => {
  const body = read(SP_PATH);
  assert.match(
    body,
    /BOOTSTRAP-WRITER-DO-NOT-REMOVE/,
    "spreadsProcessor must contain the BOOTSTRAP-WRITER-DO-NOT-REMOVE sentinel string.",
  );
});

// ── Test 3: BOOTSTRAP_FAILED event on no_ncads_candidates ──────────────────

test("[pr5i-3] spreadsProcessor emits BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE on no_ncads_candidates", () => {
  const body = read(SP_PATH);
  assert.match(
    body,
    /BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE/,
    "spreadsProcessor must emit BOOTSTRAP_FAILED_CASH_FLOW_AVAILABLE writeSystemEvent.",
  );
  assert.match(
    body,
    /no_ncads_candidates/,
    "The event must be gated on aggregatorResult.reason === 'no_ncads_candidates'.",
  );
});

// ── Test 4: computeTotalDebtService provenance has extractor ───────────────

test("[pr5i-4] computeTotalDebtService provenance objects include extractor field", () => {
  const body = read(TDS_PATH);
  const extractorMatches = body.match(/extractor:\s*["']computeTotalDebtService:v1["']/g) ?? [];
  assert.ok(
    extractorMatches.length >= 6,
    `All 6 provenance objects must have extractor: "computeTotalDebtService:v1". Found ${extractorMatches.length}.`,
  );
});

// ── Test 5: Invariant assertion module exists and is wired ─────────────────

test("[pr5i-5] assertCanonicalChainInvariants module exists and is called in spreadsProcessor", () => {
  const invariants = read(INVARIANTS_PATH);
  assert.match(
    invariants,
    /export async function assertCanonicalChainInvariants/,
    "Invariant module must export assertCanonicalChainInvariants.",
  );

  const sp = read(SP_PATH);
  assert.match(
    sp,
    /assertCanonicalChainInvariants/,
    "spreadsProcessor must call assertCanonicalChainInvariants.",
  );
  assert.match(
    sp,
    /canonical\.recompute\.invariants_checked/,
    "spreadsProcessor must emit canonical.recompute.invariants_checked event.",
  );
});

// ── Test 6: Regression test — aggregator removal detection ─────────────────

test("[pr5i-6] CRITICAL: aggregator call site exists in spreadsProcessor (regression guard)", () => {
  const body = read(SP_PATH);
  // Strip comments to find the ACTUAL call site, not just comment references
  const stripped = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const callSites = stripped.match(/runCashFlowAggregator\(\s*\{/g) ?? [];
  assert.ok(
    callSites.length >= 1,
    "INVARIANT_BOOTSTRAP_MISSED: runCashFlowAggregator call site in spreadsProcessor " +
    "has been removed. This is the cold-start bootstrap writer for CASH_FLOW_AVAILABLE. " +
    "Without it, fresh deals will have null DSCR indefinitely. " +
    "Read SPEC-FOUNDATION-V1-PR5I and the canonicalWriters.ts registry before proceeding.",
  );
});

// ── Test 7: Backfill null-gate is present ──────────────────────────────────

test("[pr5i-7] backfillFromSpreads has null-write gating", () => {
  const body = read(BACKFILL_PATH);
  assert.match(
    body,
    /BACKFILL_NULL_GATE/,
    "backfillFromSpreads must reference BACKFILL_NULL_GATE_ENABLED feature flag.",
  );
  assert.match(
    body,
    /gatedUpsert/,
    "backfillFromSpreads must use gatedUpsert wrapper to skip null-valued writes.",
  );
});

// ── Test 8: Invariant module checks the seven invariants ───────────────────

test("[pr5i-8] assertCanonicalChainInvariants checks all seven invariant IDs", () => {
  const body = read(INVARIANTS_PATH);
  for (const inv of [
    "INV-1", "INV-2", "INV-3", "INV-4", "INV-5", "INV-6", "INV-7",
  ]) {
    assert.match(
      body,
      new RegExp(`["']${inv}["']`),
      `Invariant module must check ${inv}.`,
    );
  }
});
