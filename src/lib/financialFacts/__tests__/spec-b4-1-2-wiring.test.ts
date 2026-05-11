/**
 * SPEC-B4.1.2 — Axis 2 + 3 wiring source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── V-1: computeBusinessEbitdaFacts exists ────────────────────────────────

test("[spec-b4-1-2-v1] computeBusinessEbitdaFacts.ts exists and imports slate-aware engine", () => {
  const path = join(REPO_ROOT, "src/lib/financialFacts/computeBusinessEbitdaFacts.ts");
  assert.ok(existsSync(path), "Writer file must exist");

  const body = readFileSync(path, "utf8");
  assert.match(body, /export async function computeBusinessEbitdaFacts/);
  assert.match(body, /computeEbitda/);
  assert.match(body, /loadDealMethodology/);
  assert.match(body, /ebitda_addback_stack/);
});

// ── V-2: analyzeOfficerCompFacts exists ───────────────────────────────────

test("[spec-b4-1-2-v2] analyzeOfficerCompFacts.ts exists and imports slate-aware engine", () => {
  const path = join(REPO_ROOT, "src/lib/financialFacts/analyzeOfficerCompFacts.ts");
  assert.ok(existsSync(path), "Writer file must exist");

  const body = readFileSync(path, "utf8");
  assert.match(body, /export async function analyzeOfficerCompFacts/);
  assert.match(body, /analyzeOfficerComp/);
  assert.match(body, /loadDealMethodology/);
  assert.match(body, /officer_comp/);
});

// ── V-3: Both writers registered in CANONICAL_WRITERS ─────────────────────

test("[spec-b4-1-2-v3] Both writers registered in CANONICAL_WRITERS with correct shape", () => {
  const { CANONICAL_WRITERS } = require("@/lib/financialFacts/canonicalWriters");

  const ebitdaWriter = CANONICAL_WRITERS.computeBusinessEbitdaFacts;
  assert.ok(ebitdaWriter, "computeBusinessEbitdaFacts must be registered");
  assert.equal(ebitdaWriter.role, "compute");
  assert.ok(ebitdaWriter.ownedFactKeys.includes("EBITDA"));
  assert.ok(ebitdaWriter.runsAfter.includes("backfillCanonicalFactsFromSpreads"));
  assert.ok(ebitdaWriter.runsBefore.includes("runCashFlowAggregator"));

  const officerWriter = CANONICAL_WRITERS.analyzeOfficerCompFacts;
  assert.ok(officerWriter, "analyzeOfficerCompFacts must be registered");
  assert.equal(officerWriter.role, "compute");
  assert.ok(officerWriter.ownedFactKeys.includes("OFFICER_COMP_EXCESS_ADDBACK"));
  assert.ok(officerWriter.runsAfter.includes("computeBusinessEbitdaFacts"));
});

// ── V-4: spreadsProcessor invokes both writers ────────────────────────────

test("[spec-b4-1-2-v4] spreadsProcessor invokes both writers in correct order", () => {
  const body = read("src/lib/jobs/processors/spreadsProcessor.ts");
  assert.match(body, /computeBusinessEbitdaFacts/, "Must invoke computeBusinessEbitdaFacts");
  assert.match(body, /analyzeOfficerCompFacts/, "Must invoke analyzeOfficerCompFacts");

  // Order: computeBusinessEbitdaFacts before analyzeOfficerCompFacts before runCashFlowAggregator
  const idxEbitda = body.indexOf("computeBusinessEbitdaFacts({");
  const idxOfficer = body.indexOf("analyzeOfficerCompFacts({");
  const idxAggregator = body.indexOf("runCashFlowAggregator({");
  assert.ok(idxEbitda > 0, "computeBusinessEbitdaFacts invocation must exist");
  assert.ok(idxOfficer > idxEbitda, "analyzeOfficerCompFacts must run after computeBusinessEbitdaFacts");
  assert.ok(idxAggregator > idxOfficer, "runCashFlowAggregator must run after both new writers");
});

// ── V-5: runCashFlowAggregator reads entity-summed EBITDA ─────────────────

test("[spec-b4-1-2-v5] runCashFlowAggregator prefers entity-summed EBITDA", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(body, /owner_type.*ENTITY/, "Must query ENTITY-scoped EBITDA facts");
  assert.match(body, /entityEbitdaSum/, "Must compute entityEbitdaSum");
  assert.match(body, /entityEbitdaSum !== null/, "Standard branch must check entityEbitdaSum first");
});

// ── V-6: Aggregator attaches Axis 2 provenance when entity EBITDA used ───

test("[spec-b4-1-2-v6] Aggregator adds Axis 2 provenance when entity EBITDA used", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(body, /axis:\s*"ebitda_addback_stack"/, "Must push Axis 2 provenance");
});

// ── V-7: Chain DAG is acyclic ─────────────────────────────────────────────

test("[spec-b4-1-2-v7] CANONICAL_WRITERS DAG has no broken runsAfter references", () => {
  const { CANONICAL_WRITERS } = require("@/lib/financialFacts/canonicalWriters");
  const writerNames = new Set(Object.keys(CANONICAL_WRITERS));

  // Known non-writer references that are legitimate
  const wildcards = new Set([
    "all spread renders",
    "second GCF render (PR5g)",
    "GLOBAL_CASH_FLOW renderSpread",
    "next canonical chain step (within spreadsProcessor)",
  ]);

  for (const [name, writer] of Object.entries(CANONICAL_WRITERS) as any[]) {
    for (const after of writer.runsAfter ?? []) {
      if (!wildcards.has(after)) {
        assert.ok(
          writerNames.has(after),
          `Writer ${name} claims runsAfter "${after}", but "${after}" is not in registry`,
        );
      }
    }
  }
});

// ── V-8: Correct import paths (not underwriting/) ─────────────────────────

test("[spec-b4-1-2-v8] New writers import from financialIntelligence, not underwriting", () => {
  const ebitdaBody = read("src/lib/financialFacts/computeBusinessEbitdaFacts.ts");
  const officerBody = read("src/lib/financialFacts/analyzeOfficerCompFacts.ts");

  assert.match(ebitdaBody, /from "@\/lib\/financialIntelligence\/ebitdaEngine"/);
  assert.match(officerBody, /from "@\/lib\/financialIntelligence\/officerCompEngine"/);

  assert.doesNotMatch(ebitdaBody, /from "@\/lib\/underwriting\//);
  assert.doesNotMatch(officerBody, /from "@\/lib\/underwriting\//);
});

// ── V-9: OFFICER_COMP_EXCESS_ADDBACK in CANONICAL_FACTS ──────────────────

test("[spec-b4-1-2-v9] OFFICER_COMP_EXCESS_ADDBACK registered in CANONICAL_FACTS", () => {
  const body = read("src/lib/financialFacts/keys.ts");
  assert.match(body, /OFFICER_COMP_EXCESS_ADDBACK/, "Must be in canonical facts registry");
});
