import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../writeScheduleLFacts.ts");

describe("writeScheduleLFacts structural guards", () => {
  const content = fs.readFileSync(SRC, "utf-8");

  it("file exists", () => {
    assert.ok(fs.existsSync(SRC));
  });

  it("maps total_assets to TOTAL_ASSETS", () => {
    assert.ok(content.includes('total_assets: "TOTAL_ASSETS"'));
  });

  it("maps total_liabilities to TOTAL_LIABILITIES", () => {
    assert.ok(content.includes('total_liabilities: "TOTAL_LIABILITIES"'));
  });

  it("maps total_equity to NET_WORTH (canonical key)", () => {
    assert.ok(content.includes('total_equity: "NET_WORTH"'));
  });

  it("maps partners_capital to NET_WORTH", () => {
    assert.ok(content.includes('partners_capital: "NET_WORTH"'));
  });

  it("skips unknown entity types (no default mapping)", () => {
    // Verify the function only processes keys in the map
    assert.ok(content.includes("if (!canonicalKey) continue"));
  });

  it("skips null money values", () => {
    assert.ok(content.includes("if (value === null) continue"));
  });

  it("uses factType BALANCE_SHEET for all writes", () => {
    assert.ok(content.includes('factType: "BALANCE_SHEET"'));
  });

  it("uses extractor version writeScheduleLFacts:v1", () => {
    assert.ok(content.includes('"writeScheduleLFacts:v1"'));
  });

  it("imports upsertDealFinancialFact", () => {
    assert.ok(content.includes("upsertDealFinancialFact"));
  });

  it("uses Promise.allSettled for resilience", () => {
    assert.ok(content.includes("Promise.allSettled"));
  });
});

describe("writeScheduleLFacts entity map coverage", () => {
  const content = fs.readFileSync(SRC, "utf-8");

  // Parse the SCHEDULE_L_ENTITY_MAP from source
  const mapMatch = content.match(/SCHEDULE_L_ENTITY_MAP[^{]*\{([^}]+)\}/s);
  assert.ok(mapMatch, "SCHEDULE_L_ENTITY_MAP must exist");

  const mapContent = mapMatch![1];

  const expectedMappings: [string, string][] = [
    ["total_assets", "TOTAL_ASSETS"],
    ["total_liabilities", "TOTAL_LIABILITIES"],
    ["total_equity", "NET_WORTH"],
    ["partners_capital", "NET_WORTH"],
  ];

  for (const [from, to] of expectedMappings) {
    it(`maps ${from} → ${to}`, () => {
      assert.ok(mapContent.includes(from), `Missing key: ${from}`);
      assert.ok(mapContent.includes(to), `Missing value: ${to}`);
    });
  }
});
