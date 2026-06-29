/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-2 — 2b (resolve + thread), 2c (interpret
 * conditioning), 2d (basis-change flag). Interpretation-only: values never move.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { interpret } from "@/lib/finengine/metrics/interpret";
import {
  resolveAccountingBasis,
  buildCertifiedSnapshots,
  type CertifiedFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";
import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";

const DEAL = "00000000-0000-0000-0000-000000000000";

function row(
  fact_key: string,
  fact_period_end: string,
  fact_value_num: number | null,
  source_canonical_type: string,
  owner_type: string,
  opts: { text?: string | null; confidence?: number } = {},
): CertifiedFactRow {
  return {
    fact_key,
    fact_period_end,
    fact_value_num,
    fact_value_text: opts.text ?? null,
    source_canonical_type,
    owner_type,
    confidence: opts.confidence ?? 0.8,
    extractor: "test",
    is_superseded: false,
    created_at: "2026-06-01T00:00:00Z",
  };
}

// ── 2c — interpret() conditioning ──────────────────────────────────────────
describe("Knowledge-wire-2 2c — interpret() suppresses accrual-dependent metrics on a cash basis", () => {
  it("T-2c-1: DSO under CASH → n/a, empty redFlags, caveat signal; value preserved", () => {
    const out = interpret({ metric: "DSO", value: 47 }, { accountingBasis: "CASH" });
    assert.equal(out.rating, "n/a");
    assert.deepEqual(out.redFlags, []);
    assert.match(out.signal, /cash basis/i);
    assert.equal(out.value, 47); // value still returned (transparency)
  });

  it("T-2c-2: DSO under ACCRUAL / UNKNOWN / no-basis → rated from bands (unchanged)", () => {
    const accrual = interpret({ metric: "DSO", value: 47 }, { accountingBasis: "ACCRUAL" });
    const unknown = interpret({ metric: "DSO", value: 47 }, { accountingBasis: "UNKNOWN" });
    const none = interpret({ metric: "DSO", value: 47 });
    assert.equal(accrual.rating, "weak"); // 47 days: >45 adequate band, ≤60 weak band
    assert.equal(unknown.rating, "weak");
    assert.equal(none.rating, "weak");
    assert.equal(accrual.value, 47);
  });

  it("T-2c-3: a non-accrual metric (GROSS_MARGIN) is unaffected by a cash basis", () => {
    const cash = interpret({ metric: "GROSS_MARGIN", value: 0.5 }, { accountingBasis: "CASH" });
    assert.equal(cash.rating, "strong"); // 0.5 ≥ 0.4 strong band — basis irrelevant
    assert.equal(cash.value, 0.5);
  });
});

// ── 2b — resolve + thread ──────────────────────────────────────────────────
describe("Knowledge-wire-2 2b — resolveAccountingBasis is entity-partitioned + period-matched", () => {
  const rows: CertifiedFactRow[] = [
    row("ACCOUNTING_BASIS", "2024-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "CASH" }),
    row("ACCOUNTING_BASIS", "2024-12-31", null, "PERSONAL_TAX_RETURN", "DEAL", { text: "ACCRUAL" }),
    row("ACCOUNTING_BASIS", "2023-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "ACCRUAL" }),
  ];

  it("resolves the BUSINESS basis for the matching period, never the personal one", () => {
    assert.equal(resolveAccountingBasis(rows, "BUSINESS", "2024-12-31"), "CASH");
    assert.equal(resolveAccountingBasis(rows, "PERSONAL", "2024-12-31"), "ACCRUAL");
    assert.equal(resolveAccountingBasis(rows, "BUSINESS", "2023-12-31"), "ACCRUAL");
    assert.equal(resolveAccountingBasis(rows, "BUSINESS", "2022-12-31"), "UNKNOWN"); // no fact
  });

  it("buildCertifiedSnapshots stamps the basis and excludes it from numeric facts", () => {
    const rows2: CertifiedFactRow[] = [
      row("GROSS_RECEIPTS", "2024-12-31", 365_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2024-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "CASH" }),
    ];
    const snaps = buildCertifiedSnapshots(DEAL, rows2);
    const biz = snaps.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2024-12-31");
    assert.ok(biz);
    assert.equal(biz!.accountingBasis, "CASH");
    assert.equal(biz!.facts["ACCOUNTING_BASIS"], undefined); // categorical — never a numeric fact
    assert.ok(!biz!.warnings.some((w) => w.includes("ACCOUNTING_BASIS")));
  });

  it("end-to-end: DSO cell is n/a on a cash basis, rated on an accrual basis — value identical", () => {
    const base = (basis: string): CertifiedFactRow[] => [
      row("GROSS_RECEIPTS", "2024-12-31", 365_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("SL_AR_GROSS", "2024-12-31", 100_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2024-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: basis }),
    ];
    const dsoCell = (basis: string) =>
      computeDealSpread(DEAL, base(basis)).cells.find(
        (c) => c.metric === "DSO" && c.scope === "BUSINESS" && c.period === "2024-12-31",
      );

    const cash = dsoCell("CASH");
    const accrual = dsoCell("ACCRUAL");
    assert.ok(cash && accrual);
    assert.equal(cash!.value, 100); // (100k / 365k) × 365
    assert.equal(accrual!.value, 100); // identical value — interpretation-only change
    assert.equal(cash!.rating, "n/a");
    assert.notEqual(accrual!.rating, "n/a");
  });
});

// ── 2d — basis-change flag ─────────────────────────────────────────────────
describe("Knowledge-wire-2 2d — basis-change-across-periods flag", () => {
  it("T-2d-1: mixed basis across periods fires one warning; constant basis fires none", () => {
    const mixed: CertifiedFactRow[] = [
      row("GROSS_RECEIPTS", "2023-12-31", 300_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2023-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "CASH" }),
      row("GROSS_RECEIPTS", "2024-12-31", 365_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2024-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "ACCRUAL" }),
    ];
    const warnMixed = computeDealSpread(DEAL, mixed).warnings;
    assert.ok(warnMixed.some((w) => /accounting basis changes across periods/i.test(w)));

    const constant: CertifiedFactRow[] = [
      row("GROSS_RECEIPTS", "2023-12-31", 300_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2023-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "ACCRUAL" }),
      row("GROSS_RECEIPTS", "2024-12-31", 365_000, "BUSINESS_TAX_RETURN", "DEAL"),
      row("ACCOUNTING_BASIS", "2024-12-31", null, "BUSINESS_TAX_RETURN", "DEAL", { text: "ACCRUAL" }),
    ];
    const warnConstant = computeDealSpread(DEAL, constant).warnings;
    assert.ok(!warnConstant.some((w) => /accounting basis changes across periods/i.test(w)));
  });
});
