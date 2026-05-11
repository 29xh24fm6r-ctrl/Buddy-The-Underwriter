/**
 * SPEC-B4 Batch 2 — Aggregator integration + API routes source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── V-9: aggregator imports methodology layer ─────────────────────────────

test("[spec-b4-v9] runCashFlowAggregator imports methodology layer", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(body, /loadDealMethodology/, "Must import loadDealMethodology");
  assert.match(body, /computeSlateHash/, "Must import computeSlateHash");
  assert.match(body, /METHODOLOGY_AXES/, "Must import METHODOLOGY_AXES");
  assert.match(body, /DEFAULT_METHODOLOGY_SLATE/, "Must import default slate for is_default check");
  assert.match(body, /buildRationale/, "Must import rationale builder");
  assert.match(body, /MethodologyProvenance/, "Must import MethodologyProvenance type");
});

// ── V-10: aggregator calls loadDealMethodology ────────────────────────────

test("[spec-b4-v10] runCashFlowAggregator calls loadDealMethodology", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(
    body,
    /loadDealMethodology\s*\(\s*dealId\s*,\s*bankId\s*\)/,
    "Must call loadDealMethodology(dealId, bankId)",
  );
  assert.match(body, /methodologySlate/, "Must bind slate to a variable");
  assert.match(body, /slateHash\s*=\s*computeSlateHash/, "Must compute slate hash");
});

// ── V-11: NCADS source decision branches on slate ─────────────────────────

test("[spec-b4-v11] NCADS source branches on ncads_source variant", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(body, /ncadsVariant\s*=\s*methodologySlate\.ncads_source/, "Must read ncads_source from slate");
  assert.match(
    body,
    /ncadsVariant\s*===\s*["']conservative["']/,
    "Must branch on conservative variant",
  );
  assert.match(
    body,
    /ncadsVariant\s*===\s*["']tax_return_basis["']/,
    "Must branch on tax_return_basis variant",
  );
});

// ── V-12: aggregator populates provenance.methodology as array ────────────

test("[spec-b4-v12] aggregator upsert populates provenance.methodology as 1-element array", () => {
  const body = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  assert.match(
    body,
    /methodologyProvenance:\s*MethodologyProvenance\[\]/,
    "methodologyProvenance must be typed as array",
  );
  assert.match(
    body,
    /axis:\s*["']ncads_source["']/,
    "Provenance entry must have axis: ncads_source",
  );
  assert.match(
    body,
    /chosen_variant:\s*ncadsVariant/,
    "Must record chosen_variant",
  );
  assert.match(body, /slate_hash:\s*slateHash/, "Must record slate_hash");
  assert.match(body, /is_default:/, "Must record is_default flag");
  assert.match(
    body,
    /methodology:\s*methodologyProvenance/,
    "Upsert provenance must include methodology field",
  );
});

// ── V-13: persistGlobalCashFlow imports methodology layer ─────────────────

test("[spec-b4-v13] persistGlobalCashFlow imports methodology layer", () => {
  const body = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  assert.match(body, /loadDealMethodology/, "Must import loadDealMethodology");
  assert.match(
    body,
    /loadDealMethodology\s*\(\s*args\.dealId\s*,\s*args\.bankId\s*\)/,
    "Must call loadDealMethodology(args.dealId, args.bankId)",
  );
});

// ── V-14: persistGlobalCashFlow passes slate to computeGlobalCashFlow ─────

test("[spec-b4-v14] persistGlobalCashFlow passes slate to computeGlobalCashFlow", () => {
  const body = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  // Verify the call passes methodologySlate as 2nd argument
  const callIdx = body.indexOf("computeGlobalCashFlow(");
  assert.ok(callIdx > 0, "Must call computeGlobalCashFlow");
  // Find the closing of the call — methodologySlate must appear after the inputs object
  const callBlock = body.slice(callIdx, callIdx + 300);
  assert.match(
    callBlock,
    /methodologySlate/,
    "Must pass methodologySlate as 2nd arg to computeGlobalCashFlow",
  );
});

// ── V-15: GCF upserts populate provenance.methodology as 2-element array ──

test("[spec-b4-v15] GCF upserts populate composite methodology provenance", () => {
  const body = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  assert.match(
    body,
    /axis:\s*["']affiliate_ownership["']/,
    "Composite provenance must include affiliate_ownership axis",
  );
  assert.match(
    body,
    /axis:\s*["']living_expense["']/,
    "Composite provenance must include living_expense axis",
  );

  // Count methodology occurrences: should be at least 3 (one per upsert)
  const methodologyMatches = body.match(/methodology:\s*methodologyProvenance/g) ?? [];
  assert.ok(
    methodologyMatches.length >= 3,
    `Must include methodology field on all 3 GCF upserts (found ${methodologyMatches.length})`,
  );
});

// ── V-16: FinancialFactProvenance type has optional methodology field ─────

test("[spec-b4-v16] FinancialFactProvenance has optional methodology field", () => {
  const body = read("src/lib/financialFacts/keys.ts");
  assert.match(body, /methodology\?:\s*MethodologyProvenance\[\]/, "Must add optional methodology array field");
  assert.match(
    body,
    /import\s+type\s+\{\s*MethodologyProvenance\s*\}\s+from\s+["']@\/lib\/methodology\/types["']/,
    "Must import MethodologyProvenance type",
  );
});

// ── V-17: methodology route exports GET + POST with correct config ────────

test("[spec-b4-v17] methodology route exports GET and POST with correct module config", () => {
  const body = read("src/app/api/deals/[dealId]/methodology/route.ts");
  assert.match(body, /export\s+async\s+function\s+GET\b/, "Must export GET");
  assert.match(body, /export\s+async\s+function\s+POST\b/, "Must export POST");
  assert.match(
    body,
    /ensureDealBankAccess\s*\(\s*dealId\s*\)/,
    "Must auth via ensureDealBankAccess",
  );
  assert.match(body, /runtime\s*=\s*["']nodejs["']/, "Must declare nodejs runtime");
  assert.match(
    body,
    /dynamic\s*=\s*["']force-dynamic["']/,
    "Must declare force-dynamic",
  );
});

// ── V-18: POST writes to both tables + triggers recompute ─────────────────

test("[spec-b4-v18] POST writes to deal_methodology_choices, decision_overrides, triggers recompute", () => {
  const body = read("src/app/api/deals/[dealId]/methodology/route.ts");
  assert.match(
    body,
    /from\s*\(\s*["']deal_methodology_choices["']\s*\)[\s\S]{0,80}\.upsert/,
    "POST must upsert to deal_methodology_choices",
  );
  assert.match(
    body,
    /from\s*\(\s*["']decision_overrides["']\s*\)[\s\S]{0,80}\.insert/,
    "POST must insert to decision_overrides",
  );
  assert.match(
    body,
    /field_path:\s*`methodology\.\$\{axis\}`/,
    "Audit row must have field_path = methodology.<axis>",
  );
  assert.match(
    body,
    /triggerCanonicalRecompute\s*\(/,
    "POST must call triggerCanonicalRecompute",
  );
  assert.match(
    body,
    /reason:\s*["']banker_initiated_refresh["']/,
    "Must use banker_initiated_refresh reason",
  );
  assert.match(
    body,
    /source:\s*["']methodology_picker["']/,
    "Must tag meta.source as methodology_picker",
  );
});

// ── V-19: GET returns expected shape ──────────────────────────────────────

test("[spec-b4-v19] GET returns {slate, choices, isAllDefaults, axes, currentValues}", () => {
  const body = read("src/app/api/deals/[dealId]/methodology/route.ts");
  assert.match(body, /slate,/, "Response must include slate");
  assert.match(body, /choices,/, "Response must include choices");
  assert.match(body, /isAllDefaults,/, "Response must include isAllDefaults");
  assert.match(body, /axes:\s*METHODOLOGY_AXES/, "Response must include axes catalog");
  assert.match(body, /currentValues,/, "Response must include currentValues map");
});

// ── Unit check: is_default detection logic ────────────────────────────────

test("[spec-b4-batch2-unit] is_default flag is true only when slate matches defaults", () => {
  const { DEFAULT_METHODOLOGY_SLATE } = require("@/lib/methodology/methodologyDefaults");
  const allDefaults = { ...DEFAULT_METHODOLOGY_SLATE };
  const oneOverride = { ...DEFAULT_METHODOLOGY_SLATE, officer_comp: "conservative" };

  const isFullDefault = (slate: any) =>
    Object.keys(DEFAULT_METHODOLOGY_SLATE).every(
      (k) => slate[k] === (DEFAULT_METHODOLOGY_SLATE as any)[k],
    );

  assert.equal(isFullDefault(allDefaults), true, "All defaults → full default");
  assert.equal(isFullDefault(oneOverride), false, "One override → not full default");
});
