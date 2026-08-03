import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isPerOwnerTemplateCode, expandPerOwnerItems } from "@/lib/sba/package/perOwnerExpansion";

function mockSb(owners: Array<Record<string, any>>) {
  return {
    from: (table: string) => {
      if (table === "ownership_entities") {
        return {
          select: () => ({
            eq: () => ({ data: owners }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ data: null }) }) };
    },
  };
}

describe("perOwnerExpansion", () => {
  test("isPerOwnerTemplateCode identifies per-owner codes", () => {
    assert.ok(isPerOwnerTemplateCode("SBA_413"));
    assert.ok(isPerOwnerTemplateCode("SBA_912"));
    assert.ok(isPerOwnerTemplateCode("IRS_4506C"));
    assert.ok(isPerOwnerTemplateCode("SBA_148"));
    assert.ok(isPerOwnerTemplateCode("SBA_148L"));

    assert.ok(!isPerOwnerTemplateCode("SBA_1919"));
    assert.ok(!isPerOwnerTemplateCode("SBA_1244"));
    assert.ok(!isPerOwnerTemplateCode("SBA_155"));
    assert.ok(!isPerOwnerTemplateCode("SBA_601"));
    assert.ok(!isPerOwnerTemplateCode("SBA_NOTE"));
  });

  test("expandPerOwnerItems returns nothing for deal-level codes only", async () => {
    const sb = mockSb([]);
    const result = await expandPerOwnerItems("deal-1", ["SBA_1919", "SBA_155"], sb);
    assert.strictEqual(result.length, 0);
  });

  test("SBA_413 expanded for 20%+ individual owners only", async () => {
    const sb = mockSb([
      { id: "owner-1", entity_type: "individual", display_name: "Alice", ownership_pct: 51 },
      { id: "owner-2", entity_type: "individual", display_name: "Bob", ownership_pct: 25 },
      { id: "owner-3", entity_type: "individual", display_name: "Charlie", ownership_pct: 15 },
      { id: "entity-1", entity_type: "corporation", display_name: "CorpCo", ownership_pct: 30 },
    ]);
    const result = await expandPerOwnerItems("deal-1", ["SBA_413"], sb);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map((r) => r.ownerName), ["Alice", "Bob"]);
    assert.ok(result.every((r) => r.templateCode === "SBA_413"));
  });

  test("IRS_4506C expanded for all individual owners", async () => {
    const sb = mockSb([
      { id: "owner-1", entity_type: "individual", display_name: "Alice", ownership_pct: 51 },
      { id: "owner-2", entity_type: "person", display_name: "Bob", ownership_pct: 10 },
      { id: "entity-1", entity_type: "corporation", display_name: "CorpCo", ownership_pct: 39 },
    ]);
    const result = await expandPerOwnerItems("deal-1", ["IRS_4506C"], sb);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map((r) => r.ownerName), ["Alice", "Bob"]);
  });

  test("SBA_912 expanded only for triggering owners", async () => {
    const sb = mockSb([
      { id: "owner-1", entity_type: "individual", display_name: "Alice", ownership_pct: 51, incarcerated_or_indicted_financial_crime: true },
      { id: "owner-2", entity_type: "individual", display_name: "Bob", ownership_pct: 25, incarcerated_or_indicted_financial_crime: false },
    ]);
    const result = await expandPerOwnerItems("deal-1", ["SBA_912"], sb);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].ownerName, "Alice");
  });

  test("SBA_148 vs SBA_148L split by guarantee type", async () => {
    const sb = mockSb([
      { id: "owner-1", entity_type: "individual", display_name: "Alice", ownership_pct: 51 },
      { id: "owner-2", entity_type: "individual", display_name: "Bob", ownership_pct: 10 },
    ]);
    const result = await expandPerOwnerItems("deal-1", ["SBA_148", "SBA_148L"], sb);
    const f148 = result.filter((r) => r.templateCode === "SBA_148");
    const f148L = result.filter((r) => r.templateCode === "SBA_148L");
    assert.strictEqual(f148.length, 1);
    assert.strictEqual(f148[0].ownerName, "Alice");
    assert.strictEqual(f148L.length, 1);
    assert.strictEqual(f148L[0].ownerName, "Bob");
  });

  test("two-owner deal produces correct full expansion", async () => {
    const sb = mockSb([
      { id: "owner-1", entity_type: "individual", display_name: "Alice", ownership_pct: 51, incarcerated_or_indicted_financial_crime: true },
      { id: "owner-2", entity_type: "individual", display_name: "Bob", ownership_pct: 30, incarcerated_or_indicted_financial_crime: true },
    ]);
    const result = await expandPerOwnerItems(
      "deal-1",
      ["SBA_413", "SBA_912", "IRS_4506C", "SBA_148"],
      sb,
    );
    const f413 = result.filter((r) => r.templateCode === "SBA_413");
    const f912 = result.filter((r) => r.templateCode === "SBA_912");
    const f4506 = result.filter((r) => r.templateCode === "IRS_4506C");
    const f148 = result.filter((r) => r.templateCode === "SBA_148");

    assert.strictEqual(f413.length, 2, "2 owners × 413");
    assert.strictEqual(f912.length, 2, "2 triggering owners × 912");
    assert.strictEqual(f4506.length, 2, "2 individuals × 4506-C");
    assert.strictEqual(f148.length, 2, "both owners are 20%+ → unconditional");
  });
});
