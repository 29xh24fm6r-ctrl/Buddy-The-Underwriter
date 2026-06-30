/**
 * SPEC-FINENGINE-FULL-SPREAD-GOLDEN-1 — golden-set registry tests (cutover phase 2).
 *
 * Proves: the registry emits an EBITDA intended-divergence entry per (scope, period)
 * from the INDEPENDENT derivation (NG2); the runner self-classifies OmniCare's EBITDA
 * leg as INTENDED (was UNEXPECTED/blocked in Phase 1); the golden binds the SPECIFIC
 * fix (engine drift > $1 still UNEXPECTED — keeps its teeth); and the Phase 1 net-new
 * firewall is unbroken.
 *
 * NG2 is the headline rule: the golden value comes only from goldenConservativeEbitda
 * (facts → value), never from computeDealSpread. Tested by the arithmetic assertions
 * and the import-grep guard below.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fullSpreadGoldenSet } from "@/lib/finengine/shadow/fullSpreadGoldenSet";
import { runFullSpreadShadow } from "@/lib/finengine/shadow/runFullSpreadShadow";
import { LEGACY_OMNICARE_EBITDA_BUG } from "@/lib/finengine/shadow/ebitdaGoldenSet";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5";
const GEM = "gemini_primary_v1";

function r(fact_key: string, period: string, value: number, sct: string, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL");

// C-corp fixture (M1_TAXABLE_INCOME base, no OBI). Independent golden:
//   2023: -457567 + dep 61656 = -395911 ;  2024: 200925 + dep 210207 = 411132
const CCORP_ROWS: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 0),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("OFFICER_COMPENSATION", "2023-12-31", 200000), biz("OFFICER_COMPENSATION", "2024-12-31", 310000),
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000),
  biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_TOTAL_ASSETS", "2023-12-31", 3003718), biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_EQUITY", "2024-12-31", 6800000),
  biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
];

const GOLDEN_2023 = -457567 + 61656; // independent arithmetic, NOT the engine
const GOLDEN_2024 = 200925 + 210207;

/** Legacy EBITDA bug rows (BUSINESS-sourced → scopeOf=BUSINESS), distinct from engine. */
const legacyBug = (): CertifiedFactRow[] => [
  biz("EBITDA", "2023-12-31", LEGACY_OMNICARE_EBITDA_BUG),
  biz("EBITDA", "2024-12-31", LEGACY_OMNICARE_EBITDA_BUG),
];

describe("[fsg] fullSpreadGoldenSet — independent registry (NG2)", () => {
  it("[fsg-1] C-corp fixture → one EBITDA entry per period; value = independent arithmetic", () => {
    const golden = fullSpreadGoldenSet(DEAL, CCORP_ROWS);
    const ebitda = golden.filter((g) => g.factKey === "EBITDA");
    assert.equal(ebitda.length, 2);
    const g23 = ebitda.find((g) => g.fiscalPeriodEnd === "2023-12-31")!;
    const g24 = ebitda.find((g) => g.fiscalPeriodEnd === "2024-12-31")!;
    assert.ok(g23 && g24);
    // Assert the ARITHMETIC (base + interest + dep + amort), never an engine readback.
    assert.equal(g23.expectedNewValue, GOLDEN_2023); // -395911
    assert.equal(g24.expectedNewValue, GOLDEN_2024); // 411132
    // Every entry is for the gated metric only.
    assert.ok(golden.every((g) => g.factKey === "EBITDA"));
  });

  it("[fsg-2] unresolved base → no entry registered (stays UNEXPECTED, not papered over)", () => {
    // A BUSINESS period with balance-sheet facts but NO income base.
    const noBase: CertifiedFactRow[] = [
      biz("TOTAL_CURRENT_ASSETS", "2025-12-31", 100),
      biz("TOTAL_CURRENT_LIABILITIES", "2025-12-31", 50),
    ];
    const golden = fullSpreadGoldenSet(DEAL, noBase);
    assert.equal(golden.length, 0);
  });

  it("[fsg-3] each entry's ownerType equals the snapshot entityScope (keys to the shadow side, R3)", () => {
    const golden = fullSpreadGoldenSet(DEAL, CCORP_ROWS);
    assert.ok(golden.length >= 1);
    assert.ok(golden.every((g) => g.ownerType === "BUSINESS"));
  });

  it("[fsg-NG2] golden tracks the FACTS independently — perturbing a base fact moves the golden by exactly that amount", () => {
    const base = fullSpreadGoldenSet(DEAL, CCORP_ROWS).find((g) => g.fiscalPeriodEnd === "2024-12-31")!;
    // Bump depreciation by +1,000,000 in the facts; the independent golden must move +1,000,000.
    const perturbed = CCORP_ROWS.map((row) =>
      row.fact_key === "DEPRECIATION" && row.fact_period_end === "2024-12-31"
        ? { ...row, fact_value_num: 210207 + 1_000_000 }
        : row,
    );
    const moved = fullSpreadGoldenSet(DEAL, perturbed).find((g) => g.fiscalPeriodEnd === "2024-12-31")!;
    assert.equal((moved.expectedNewValue ?? 0) - (base.expectedNewValue ?? 0), 1_000_000);
    // And it equals the hand arithmetic — proving facts→value, no engine in the path.
    assert.equal(moved.expectedNewValue, 200925 + 210207 + 1_000_000);
  });
});

describe("[fsg] runFullSpreadShadow with the registry — end-to-end classification", () => {
  it("[fsg-4] legacy bug vs engine fix, DEFAULT registry → EBITDA INTENDED, cutoverBlocked=false", () => {
    const rows = [...CCORP_ROWS, ...legacyBug()];
    const { report } = runFullSpreadShadow(DEAL, rows); // omit goldenSet → registry default
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    assert.ok(report.intended >= 1);
    assert.equal(report.intended, report.total);
    for (const d of report.divergences) {
      assert.equal(d.factKey, "EBITDA");
      assert.equal(d.classification, "INTENDED");
      assert.ok((d.note ?? "").includes("SPEC-FINENGINE-FULL-SPREAD-GOLDEN-1"));
    }
  });

  it("[fsg-5] engine drifts off the registered golden by > $1 → UNEXPECTED, cutoverBlocked=true (keeps teeth)", () => {
    // Register the golden for the CORRECT facts, then run the harness on facts where
    // depreciation is inflated +1M so the engine EBITDA drifts off the registered value.
    const registeredGolden = fullSpreadGoldenSet(DEAL, CCORP_ROWS);
    const drifted = [
      ...CCORP_ROWS.map((row) =>
        row.fact_key === "DEPRECIATION" && row.fact_period_end === "2024-12-31"
          ? { ...row, fact_value_num: 210207 + 1_000_000 }
          : row,
      ),
      ...legacyBug(),
    ];
    const { report } = runFullSpreadShadow(DEAL, drifted, registeredGolden);
    assert.equal(report.cutoverBlocked, true);
    assert.ok(report.unexpected >= 1);
    const u = report.divergences.find((d) => d.classification === "UNEXPECTED" && d.fiscalPeriodEnd === "2024-12-31");
    assert.ok(u, "the drifted 2024 EBITDA reads UNEXPECTED");
  });

  it("[fsg-6] Phase 1 firewall unbroken — a net-new ratio with planted absurd legacy still never gates", () => {
    const rows = [
      ...CCORP_ROWS,
      ...legacyBug(),
      biz("CURRENT_RATIO", "2023-12-31", 999.0),
      biz("CURRENT_RATIO", "2024-12-31", 999.0),
    ];
    const { report, additiveMetrics } = runFullSpreadShadow(DEAL, rows); // registry default
    // EBITDA is INTENDED; CURRENT_RATIO never enters the gate → still unblocked.
    assert.equal(report.cutoverBlocked, false);
    assert.ok(report.divergences.every((d) => d.factKey !== "CURRENT_RATIO"));
    const cr = additiveMetrics.find((m) => m.metric === "CURRENT_RATIO" && m.period === "2023-12-31");
    assert.ok(cr && cr.value !== 999.0);
  });
});

describe("[fsg] source guard — NG2 import firewall", () => {
  it("[fsg-7] fullSpreadGoldenSet imports the independent golden, NOT the engine spread", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../shadow/fullSpreadGoldenSet.ts", import.meta.url)),
      "utf8",
    );
    // Strip block + line comments so prose mentioning the engine doesn't trip the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/goldenConservativeEbitda/.test(code), "must import the independent derivation");
    assert.ok(!/computeDealSpread/.test(code), "must NOT reference computeDealSpread (NG2)");
    assert.ok(!/spread\/dealSpread/.test(code), "must NOT import the engine spread module (NG2)");
  });
});
