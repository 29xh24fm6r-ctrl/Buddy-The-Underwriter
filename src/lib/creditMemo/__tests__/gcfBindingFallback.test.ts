import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveGcfFactValue, type GcfFactRow } from "@/lib/financialFacts/canonicalGcfCore";

/**
 * SPEC-CREDIT-MEMO-PERFECTION-PROGRAM-1 Phase 2 — the memo's GCF VALUE binding
 * (buildBindings.ts) resolves Global Cash Flow through the canonical selector, so
 * a deal whose value exists only under the legacy GLOBAL_CASH_FLOW key no longer
 * renders a null GCF in the memo.
 */

const row = (over: Partial<GcfFactRow>): GcfFactRow =>
  ({ fact_key: "X", fact_value_num: null, owner_type: "DEAL", created_at: "2026-01-01T00:00:00Z", ...over });

describe("GCF resolution used by the memo binding", () => {
  it("prefers the canonical GCF_GLOBAL_CASH_FLOW key when present", () => {
    const r = resolveGcfFactValue([
      row({ fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 500_000, created_at: "2026-02-01T00:00:00Z" }),
      row({ fact_key: "GLOBAL_CASH_FLOW", fact_value_num: 400_000, created_at: "2026-03-01T00:00:00Z" }),
    ]);
    assert.equal(r.value, 500_000);
    assert.equal(r.factKey, "GCF_GLOBAL_CASH_FLOW");
    assert.equal(r.usedLegacy, false);
  });

  it("falls back to the legacy GLOBAL_CASH_FLOW key (memo no longer shows null GCF)", () => {
    const r = resolveGcfFactValue([row({ fact_key: "GLOBAL_CASH_FLOW", fact_value_num: 425_000 })]);
    assert.equal(r.value, 425_000);
    assert.equal(r.factKey, "GLOBAL_CASH_FLOW");
    assert.equal(r.usedLegacy, true);
  });

  it("null only when neither key exists", () => {
    assert.equal(resolveGcfFactValue([row({ fact_key: "SOMETHING_ELSE", fact_value_num: 1 })]).value, null);
  });
});

describe("buildBindings GCF source contract (no direct key consumer)", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/creditMemo/buildBindings.ts"), "utf8");
  it("resolves global cash flow via resolveGcfFactValue", () => {
    assert.ok(/resolveGcfFactValue\(/.test(src), "must call the canonical selector");
  });
  it("no longer binds globalCashFlow directly to the hardcoded canonical key", () => {
    assert.ok(
      !/globalCashFlow:\s*bindFact\(\{[^}]*GCF_GLOBAL_CASH_FLOW/.test(src),
      "globalCashFlow must not be a direct GCF_GLOBAL_CASH_FLOW bindFact consumer",
    );
  });
});
