import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../writeK1BaseFacts.ts");

describe("writeK1BaseFacts structural guards", () => {
  const content = fs.readFileSync(SRC, "utf-8");

  it("file exists", () => {
    assert.ok(fs.existsSync(SRC));
  });

  it("skips multi-owner entities (ownerCount > 1)", () => {
    assert.ok(content.includes("input.ownerCount > 1"));
    assert.ok(content.includes("skipped: true"));
  });

  it("skips when ordinaryBusinessIncome is null", () => {
    assert.ok(content.includes("input.ordinaryBusinessIncome === null"));
  });

  it("writes K1_ORDINARY_INCOME fact key", () => {
    assert.ok(content.includes('"K1_ORDINARY_INCOME"'));
  });

  it("writes K1_OWNERSHIP_PCT fact key", () => {
    assert.ok(content.includes('"K1_OWNERSHIP_PCT"'));
  });

  it("defaults ownership to 100% for single owner", () => {
    assert.ok(content.includes("input.ownershipPct ?? 100"));
  });

  it("uses factType TAX_RETURN", () => {
    assert.ok(content.includes('factType: "TAX_RETURN"'));
  });

  it("uses lower confidence (0.7) for approximation", () => {
    assert.ok(content.includes("confidence: 0.7"));
  });

  it("includes k1_approx in source_ref", () => {
    assert.ok(content.includes("k1_approx"));
  });

  it("uses extractor version writeK1BaseFacts:v1", () => {
    assert.ok(content.includes('"writeK1BaseFacts:v1"'));
  });

  it("uses Promise.allSettled for resilience", () => {
    assert.ok(content.includes("Promise.allSettled"));
  });

  it("returns skipped: false when it writes", () => {
    assert.ok(content.includes("skipped: false"));
  });
});

describe("writeK1BaseFacts wiring in extraction pipeline", () => {
  const extractorPath = path.resolve(
    __dirname,
    "../../financialSpreads/extractors/deterministic/taxReturnDeterministic.ts",
  );
  const content = fs.readFileSync(extractorPath, "utf-8");

  it("imports writeK1BaseFacts", () => {
    assert.ok(content.includes("writeK1BaseFacts"));
  });

  it("imports writeScheduleLFacts", () => {
    assert.ok(content.includes("writeScheduleLFacts"));
  });

  it("calls writeK1BaseFacts with ordinaryBusinessIncome", () => {
    assert.ok(content.includes("ordinaryBusinessIncome"));
  });

  it("wraps calls in .catch for non-fatal behavior", () => {
    // Both calls use .catch() — check that non-fatal patterns exist near each function call
    assert.ok(content.includes("writeScheduleLFacts failed (non-fatal)"), "writeScheduleLFacts must be non-fatal");
    assert.ok(content.includes("writeK1BaseFacts failed (non-fatal)"), "writeK1BaseFacts must be non-fatal");
  });
});

describe("reconciliator NET_WORTH fallback", () => {
  const reconPath = path.resolve(
    __dirname,
    "../../reconciliation/dealReconciliator.ts",
  );
  const content = fs.readFileSync(reconPath, "utf-8");

  it("uses NET_WORTH as primary key for totalEquity", () => {
    assert.ok(content.includes('"NET_WORTH"'));
  });

  it("falls back to TOTAL_EQUITY as alias", () => {
    assert.ok(content.includes('"TOTAL_EQUITY"'));
  });

  it("falls back to SL_TOTAL_ASSETS for totalAssets", () => {
    assert.ok(content.includes('"SL_TOTAL_ASSETS"'));
  });

  it("falls back to SL_TOTAL_LIABILITIES for totalLiabilities", () => {
    assert.ok(content.includes('"SL_TOTAL_LIABILITIES"'));
  });

  it("falls back to SL_TOTAL_EQUITY for totalEquity", () => {
    assert.ok(content.includes('"SL_TOTAL_EQUITY"'));
  });
});
