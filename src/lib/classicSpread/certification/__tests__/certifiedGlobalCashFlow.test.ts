import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  certifyGlobalCashFlow,
  getGcfCertification,
  type GcfRowInput,
  type GcfSourceFact,
} from "../certifiedGlobalCashFlow";

/**
 * SPEC-CLASSIC-SPREAD-GCF-CERTIFICATION-1 (Phase 4) — a GCF value certifies only when its
 * source period is coherent with the row's label and its personal-income dependency is not
 * blocked. No reconcileFinancialFacts.
 */

function src(over: Partial<GcfSourceFact>): GcfSourceFact {
  return {
    id: Math.random().toString(36).slice(2),
    factKey: "CASH_FLOW_AVAILABLE",
    value: 205_112,
    sourcePeriod: "2024-12-31",
    ownerType: "DEAL",
    ownerEntityId: null,
    documentId: "doc-cf",
    canonicalType: null,
    factType: "FINANCIAL_ANALYSIS",
    confidence: 0.85,
    extractor: "runCashFlowAggregator:v2",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}

function row(over: Partial<GcfRowInput>): GcfRowInput {
  return {
    row: "Entity Cash Flow Available",
    labelPeriod: "2024",
    labelKind: "tax_year",
    sources: [src({})],
    ...over,
  };
}

describe("certifyGlobalCashFlow — period coherence", () => {
  it('blocks "Tax Year 2022" paired with a 2026-03-31 interim source', () => {
    const r = certifyGlobalCashFlow([
      row({ labelPeriod: "2022", labelKind: "tax_year", sources: [src({ sourcePeriod: "2026-03-31" })] }),
    ]);
    const cert = getGcfCertification(r, "Entity Cash Flow Available")!;
    assert.equal(cert.value.status, "blocked");
    assert.equal(cert.value.value, null);
    assert.equal(cert.labelPeriod, "2022");
    assert.equal(cert.sourcePeriod, "2026-03-31");
    assert.match(cert.reason, /conflicts with source period/);
  });

  it("certifies a same-year tax-return (year-end) GCF source", () => {
    const r = certifyGlobalCashFlow([
      row({ labelPeriod: "2024", labelKind: "tax_year", sources: [src({ sourcePeriod: "2024-12-31" })] }),
    ]);
    const cert = getGcfCertification(r, "Entity Cash Flow Available")!;
    assert.equal(cert.value.status, "certified");
    assert.equal(cert.value.value, 205_112);
  });

  it("certifies an interim source only under an interim label", () => {
    const interim = certifyGlobalCashFlow([
      row({ row: "Interim Cash Flow", labelPeriod: "2026-03-31", labelKind: "interim", sources: [src({ sourcePeriod: "2026-03-31" })] }),
    ]);
    assert.equal(getGcfCertification(interim, "Interim Cash Flow")!.value.status, "certified");

    // same interim source, but presented as a tax year → blocked (masquerading)
    const masquerade = certifyGlobalCashFlow([
      row({ row: "Interim Cash Flow", labelPeriod: "2026", labelKind: "tax_year", sources: [src({ sourcePeriod: "2026-03-31" })] }),
    ]);
    assert.equal(getGcfCertification(masquerade, "Interim Cash Flow")!.value.status, "blocked");
  });

  it("a sentinel/unknown source period (1900-01-01) cannot back a tax-year label", () => {
    const r = certifyGlobalCashFlow([
      row({ labelPeriod: "2024", labelKind: "tax_year", sources: [src({ sourcePeriod: "1900-01-01" })] }),
    ]);
    const cert = getGcfCertification(r, "Entity Cash Flow Available")!;
    assert.equal(cert.value.status, "blocked");
    assert.match(cert.reason, /no usable provenance/);
  });
});

describe("certifyGlobalCashFlow — personal-income dependency gate", () => {
  const okRow = (): GcfRowInput =>
    row({ row: "Global Cash Flow", labelPeriod: "2024", labelKind: "tax_year", dependsOnPersonalIncome: true, sources: [src({ factKey: "GCF_GLOBAL_CASH_FLOW", value: 103_865, sourcePeriod: "2024-12-31" })] });

  it("blocked personal income → GCF is NOT final-certified (blocked)", () => {
    const r = certifyGlobalCashFlow([okRow()], { personalIncomeDependency: "blocked" });
    const cert = getGcfCertification(r, "Global Cash Flow")!;
    assert.equal(cert.value.status, "blocked");
    assert.equal(cert.preliminary, false);
    assert.match(cert.reason, /personal income that is blocked/);
  });

  it("preliminary personal income → GCF is preliminary/limited, not clean", () => {
    const r = certifyGlobalCashFlow([okRow()], { personalIncomeDependency: "preliminary" });
    const cert = getGcfCertification(r, "Global Cash Flow")!;
    assert.equal(cert.value.status, "certified");
    assert.equal(cert.preliminary, true);
    assert.ok(cert.value.caveats.some((c) => /Preliminary/.test(c)));
  });

  it("ok personal income → clean certification (not preliminary)", () => {
    const r = certifyGlobalCashFlow([okRow()], { personalIncomeDependency: "ok" });
    const cert = getGcfCertification(r, "Global Cash Flow")!;
    assert.equal(cert.value.status, "certified");
    assert.equal(cert.preliminary, false);
    assert.equal(cert.value.caveats.length, 0);
  });

  it("a row that does NOT depend on personal income is unaffected by a blocked dependency", () => {
    const r = certifyGlobalCashFlow(
      [row({ labelPeriod: "2024", labelKind: "tax_year", dependsOnPersonalIncome: false, sources: [src({ sourcePeriod: "2024-12-31" })] })],
      { personalIncomeDependency: "blocked" },
    );
    assert.equal(getGcfCertification(r, "Entity Cash Flow Available")!.value.status, "certified");
  });
});

describe("certifyGlobalCashFlow — lifecycle + audit + purity", () => {
  it("superseded / rejected / system_invalidated sources are ignored", () => {
    const r = certifyGlobalCashFlow([
      row({
        labelPeriod: "2024",
        labelKind: "tax_year",
        sources: [
          src({ id: "ok", value: 205_112, sourcePeriod: "2024-12-31" }),
          src({ id: "sup", value: 999_999, sourcePeriod: "2024-12-31", is_superseded: true }),
          src({ id: "rej", value: 888_888, sourcePeriod: "2024-12-31", resolution_status: "rejected" }),
          src({ id: "inv", value: 777_777, sourcePeriod: "2024-12-31", resolution_status: "system_invalidated" }),
        ],
      }),
    ]);
    const cert = getGcfCertification(r, "Entity Cash Flow Available")!;
    assert.equal(cert.value.value, 205_112);
    assert.ok(!cert.rejected.some((x) => [999_999, 888_888, 777_777].includes(x.value as number)));
  });

  it("audit captures label period, source period, source family, and dependency status", () => {
    const r = certifyGlobalCashFlow(
      [row({ row: "Global Cash Flow", labelPeriod: "2022", labelKind: "tax_year", dependsOnPersonalIncome: true, sources: [src({ sourcePeriod: "2026-03-31" })] })],
      { personalIncomeDependency: "preliminary" },
    );
    const cert = getGcfCertification(r, "Global Cash Flow")!;
    assert.equal(cert.labelPeriod, "2022");
    assert.equal(cert.sourcePeriod, "2026-03-31");
    assert.equal(cert.sourceFamily, "COMPUTED_CASH_FLOW");
    assert.equal(cert.dependencyStatus, "preliminary");
    // period conflict dominates the dependency gate → blocked
    assert.equal(cert.value.status, "blocked");
    const auditRow = r.auditRows.find((a) => a.row === "Global Cash Flow");
    assert.equal(auditRow?.page, "global_cash_flow");
    assert.equal(auditRow?.pass, false);
  });

  it("certifiedGlobalCashFlow.ts does not import or call reconcileFinancialFacts", () => {
    const code = fs
      .readFileSync("src/lib/classicSpread/certification/certifiedGlobalCashFlow.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/\bimport\b[\s\S]*?reconcileFinancialFacts/.test(code));
    assert.ok(!/reconcileFinancialFacts\s*\(/.test(code));
    assert.ok(!/from\s+["'][^"']*certifyFactSelection["']/.test(code));
  });
});
