/**
 * Phase 10 — V2 Determinism Guard
 *
 * Institutional requirement: the authoritative computation engine must be
 * fully deterministic. Same inputs → same outputs, every time.
 *
 * Also verifies the mode selector default is v2_primary.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildFinancialModel } from "../buildFinancialModel";
import { evaluateMetricGraph, topologicalSort } from "../metricGraph";
import { renderFromFinancialModel } from "../renderer/v2Adapter";
import { canonicalHash } from "../hash/canonicalSerialize";
import {
  selectModelEngineMode,
  isShadowCompareEnabled,
  _resetAllowlistCache,
} from "../modeSelector";
import type { FinancialModel, MetricDefinition } from "../types";

// ---------------------------------------------------------------------------
// Env var save/restore
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "MODEL_ENGINE_PRIMARY",
  "MODEL_ENGINE_MODE",
  "V2_PRIMARY_DEAL_ALLOWLIST",
  "V2_PRIMARY_BANK_ALLOWLIST",
  "V1_RENDERER_DISABLED",
  "SHADOW_COMPARE",
] as const;

let savedEnv: Record<string, string | undefined>;

function saveEnv() {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetAllowlistCache();
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.USE_MODEL_ENGINE_V2;
  _resetAllowlistCache();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEAL_ID = "determinism-test-deal";

const SAMPLE_FACTS = [
  { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "2024-12-31", confidence: 0.95 },
  { fact_type: "INCOME_STATEMENT", fact_key: "COGS", fact_value_num: 400000, fact_period_end: "2024-12-31", confidence: 0.90 },
  { fact_type: "INCOME_STATEMENT", fact_key: "OPERATING_EXPENSES", fact_value_num: 200000, fact_period_end: "2024-12-31", confidence: 0.90 },
  { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 300000, fact_period_end: "2024-12-31", confidence: 0.85 },
  { fact_type: "INCOME_STATEMENT", fact_key: "INTEREST_EXPENSE", fact_value_num: 50000, fact_period_end: "2024-12-31", confidence: 0.90 },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 5000000, fact_period_end: "2024-12-31", confidence: 0.95 },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 3000000, fact_period_end: "2024-12-31", confidence: 0.90 },
  { fact_type: "BALANCE_SHEET", fact_key: "CASH_AND_EQUIVALENTS", fact_value_num: 200000, fact_period_end: "2024-12-31", confidence: 0.90 },
];

const SAMPLE_METRICS: MetricDefinition[] = [
  {
    id: "m1",
    version: "v1",
    key: "GROSS_PROFIT",
    dependsOn: ["REVENUE", "COGS"],
    formula: { type: "subtract", left: "REVENUE", right: "COGS" },
  },
  {
    id: "m2",
    version: "v1",
    key: "GROSS_MARGIN",
    dependsOn: ["GROSS_PROFIT", "REVENUE"],
    formula: { type: "divide", left: "GROSS_PROFIT", right: "REVENUE" },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("V2 Determinism Guard", () => {
  it("buildFinancialModel: same facts → identical model", () => {
    const model1 = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);
    const model2 = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);

    assert.equal(model1.dealId, model2.dealId);
    assert.equal(model1.periods.length, model2.periods.length);
    assert.deepEqual(model1.periods, model2.periods);
  });

  it("evaluateMetricGraph: same inputs → identical outputs", () => {
    const baseValues = { REVENUE: 1000000, COGS: 400000 };
    const result1 = evaluateMetricGraph(SAMPLE_METRICS, baseValues);
    const result2 = evaluateMetricGraph(SAMPLE_METRICS, baseValues);

    assert.deepEqual(result1, result2);
    assert.equal(result1["GROSS_PROFIT"], 600000);
    assert.equal(result1["GROSS_MARGIN"], 0.6);
  });

  it("renderFromFinancialModel: same model → identical ViewModel (excluding generatedAt)", () => {
    const model = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);
    const vm1 = renderFromFinancialModel(model, DEAL_ID);
    const vm2 = renderFromFinancialModel(model, DEAL_ID);

    // Exclude non-deterministic generatedAt
    vm1.generatedAt = "FIXED";
    vm2.generatedAt = "FIXED";

    assert.deepEqual(vm1, vm2);
  });

  it("canonicalHash: identical models → identical hashes", () => {
    const model1 = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);
    const model2 = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);

    const hash1 = canonicalHash(model1);
    const hash2 = canonicalHash(model2);

    assert.equal(hash1, hash2);
    assert.ok(hash1.length > 0, "hash must be non-empty");
  });

  it("canonicalHash: different inputs → different hashes", () => {
    const model1 = buildFinancialModel(DEAL_ID, SAMPLE_FACTS as any);
    const modifiedFacts = [...SAMPLE_FACTS];
    modifiedFacts[0] = { ...modifiedFacts[0], fact_value_num: 999999 };
    const model2 = buildFinancialModel(DEAL_ID, modifiedFacts as any);

    const hash1 = canonicalHash(model1);
    const hash2 = canonicalHash(model2);

    assert.notEqual(hash1, hash2);
  });

  it("topologicalSort: stable ordering across calls", () => {
    const sorted1 = topologicalSort(SAMPLE_METRICS);
    const sorted2 = topologicalSort(SAMPLE_METRICS);

    assert.deepEqual(
      sorted1.map((m) => m.key),
      sorted2.map((m) => m.key),
    );
  });
});

describe("Mode selector defaults (Phase 10)", () => {
  beforeEach(() => {
    saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("selectModelEngineMode() with no env vars returns v2_primary (enforced)", () => {
    const r = selectModelEngineMode();
    assert.equal(r.mode, "v2_primary");
    assert.equal(r.reason, "enforced");
  });

  it("isShadowCompareEnabled() defaults to false", () => {
    assert.equal(isShadowCompareEnabled(), false);
  });
});

describe("Pure engine files: no non-deterministic functions", () => {
  const PURE_FILES = [
    "src/lib/modelEngine/buildFinancialModel.ts",
    "src/lib/modelEngine/renderer/v2Adapter.ts",
    "src/lib/modelEngine/metricGraph.ts",
  ];

  const BANNED_PATTERNS = [
    /Math\.random\s*\(/,
    /Date\.now\s*\(/,
    /crypto\.randomUUID\s*\(/,
  ];

  for (const filePath of PURE_FILES) {
    it(`${path.basename(filePath)} has no Math.random/Date.now/crypto.randomUUID`, () => {
      const fullPath = path.resolve(filePath);
      const content = fs.readFileSync(fullPath, "utf-8");

      for (const pattern of BANNED_PATTERNS) {
        const match = content.match(pattern);
        assert.ok(
          !match,
          `${filePath} contains banned non-deterministic call: ${match?.[0]}`,
        );
      }
    });
  }
});
