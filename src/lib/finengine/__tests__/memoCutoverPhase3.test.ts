/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 3 tests.
 *  3a submission enforcement (gated on the per-tenant flag),
 *  3b multi-deal regression (no deal regresses to UNEXPECTED),
 *  3c property invariants over generated deals.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread, type SpreadValidation } from "@/lib/finengine/spread/validateSpread";
import { buildCertifiedSnapshots, type CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { enforceMemoSubmission } from "@/lib/finengine/memo/finengineMemoPackage";
import { isMemoEngineCutOver } from "@/lib/finengine/featureFlags";
import { REGRESSION_DEALS } from "@/lib/finengine/__tests__/__fixtures__/regressionDeals";

const blocked: SpreadValidation = { dealId: "d", checks: [], zero: 0, intended: 0, unexpected: 1, cutoverBlocked: true };
const clean: SpreadValidation = { dealId: "d", checks: [], zero: 5, intended: 0, unexpected: 0, cutoverBlocked: false };

describe("Phase 3a — submission enforcement is gated on the tenant flag", () => {
  it("blocks finalization when the engine is live AND the spread is blocked", () => {
    assert.throws(() => enforceMemoSubmission(blocked, { cutoverEnabled: true }), /memo submission blocked/);
  });
  it("never blocks a tenant still on the legacy renderer (flag OFF)", () => {
    const gate = enforceMemoSubmission(blocked, { cutoverEnabled: false });
    assert.equal(gate.blocked, true); // reported…
    // …but no throw — legacy tenants are never bound by the engine gate.
  });
  it("a clean spread finalizes regardless of the flag", () => {
    assert.doesNotThrow(() => enforceMemoSubmission(clean, { cutoverEnabled: true }));
  });
  it("the per-tenant memo cutover flag defaults OFF", () => {
    assert.equal(isMemoEngineCutOver("bank-123"), false);
    assert.equal(isMemoEngineCutOver("bank-123", { "bank-123": true }), true);
    assert.equal(isMemoEngineCutOver(null), false);
  });
});

describe("Phase 3b — multi-deal regression (no deal regresses)", () => {
  for (const d of REGRESSION_DEALS) {
    it(`${d.name} validates cutover-clean (0 UNEXPECTED)`, () => {
      const spread = computeDealSpread(d.id, d.rows);
      const val = validateSpread(spread, { scope: "BUSINESS", rawRows: d.rows });
      assert.equal(val.unexpected, 0, val.checks.filter((c) => c.classification === "UNEXPECTED").map((c) => `${c.metric}@${c.period}`).join(", "));
      assert.equal(val.cutoverBlocked, false);
      assert.ok(val.zero > 0, "the deal actually exercised the gate");
    });
  }
});

// Deterministic LCG so the property sweep is reproducible (no Math.random nondeterminism).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const GEM = "gemini_primary_v1";
function bizRow(k: string, p: string, v: number): CertifiedFactRow {
  return { fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}

describe("Phase 3c — property invariants over generated deals", () => {
  it("entity partition never lets a PERSONAL value into a BUSINESS metric (50 generated deals)", () => {
    const rand = lcg(20260628);
    for (let n = 0; n < 50; n++) {
      const bizIncome = Math.round((rand() - 0.5) * 1_000_000); // can be a loss
      const personal = Math.round(rand() * 500_000) + 1; // distinct positive guarantor income
      const dep = Math.round(rand() * 200_000);
      const rows: CertifiedFactRow[] = [
        bizRow("M1_TAXABLE_INCOME", "2023-12-31", bizIncome), bizRow("NET_INCOME", "2023-12-31", bizIncome), bizRow("DEPRECIATION", "2023-12-31", dep),
        { fact_key: "TAXABLE_INCOME", fact_period_end: "2023-12-31", fact_value_num: personal, source_canonical_type: "PERSONAL_TAX_RETURN", owner_type: "DEAL", confidence: 0.95, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" },
      ];
      const snaps = buildCertifiedSnapshots("g", rows);
      const biz = snaps.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2023-12-31");
      // No business fact may carry the (distinct) personal value, even though it has higher confidence.
      for (const [, v] of Object.entries(biz?.facts ?? {})) {
        assert.notEqual(v, personal, `personal income ${personal} leaked into a business metric (deal ${n})`);
      }
    }
  });

  it("no cross-period substitution: a single-period component never appears in another period (NG3)", () => {
    const rand = lcg(424242);
    for (let n = 0; n < 50; n++) {
      const interest = Math.round(rand() * 400_000) + 1000;
      const rows: CertifiedFactRow[] = [
        bizRow("M1_TAXABLE_INCOME", "2023-12-31", 100000), bizRow("NET_INCOME", "2023-12-31", 100000),
        bizRow("M1_TAXABLE_INCOME", "2024-12-31", 120000), bizRow("NET_INCOME", "2024-12-31", 120000),
        bizRow("INTEREST_EXPENSE", "2025-12-31", interest), // only on 2025
      ];
      const snaps = buildCertifiedSnapshots("g", rows);
      for (const s of snaps) {
        if (s.fiscalPeriodEnd !== "2025-12-31") {
          assert.equal(s.facts["INTEREST_EXPENSE"], undefined, `interest borrowed into ${s.fiscalPeriodEnd} (deal ${n})`);
        }
      }
    }
  });

  it("a blocked spread can never finalize while the engine is live", () => {
    const rand = lcg(7);
    for (let n = 0; n < 20; n++) {
      const v: SpreadValidation = { dealId: "g", checks: [], zero: Math.round(rand() * 10), intended: 0, unexpected: 1 + Math.round(rand() * 3), cutoverBlocked: true };
      assert.throws(() => enforceMemoSubmission(v, { cutoverEnabled: true }));
    }
  });
});
