import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  certifyPersonalIncome,
  getPersonalCertified,
  type PersonalIncomeFact,
} from "../certifiedPersonalIncome";

/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3) — the personal
 * page must select the strongest fact ACROSS owner families per year/semantic key and block
 * weak OCR micro-stubs (W-2 = 3, AGI = 0, TAXABLE = 456). No reconcileFinancialFacts.
 */

function pf(over: Partial<PersonalIncomeFact>): PersonalIncomeFact {
  return {
    id: Math.random().toString(36).slice(2),
    fact_key: "WAGES_W2",
    fact_value_num: 0,
    fact_period_end: "2023-12-31",
    owner_type: "PERSONAL",
    owner_entity_id: "owner-1",
    source_document_id: "doc-1040",
    source_canonical_type: "PERSONAL_TAX_RETURN",
    fact_type: "PERSONAL_INCOME",
    confidence: 0.55,
    extractor: "personalIncomeExtractor:v2:deterministic",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}

/** Weak PERSONAL family + strong DEAL family, as in OmniCare dc52c626 (2023). */
function omniCare2023(): PersonalIncomeFact[] {
  return [
    // weak family (owner_type=PERSONAL, fact_type=PERSONAL_INCOME, conf 0.55, deterministic OCR)
    pf({ fact_key: "WAGES_W2", fact_value_num: 3 }),
    pf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0 }),
    pf({ fact_key: "TAXABLE_INCOME", fact_value_num: 456 }),
    // strong family (owner_type=DEAL, fact_type=TAX_RETURN, conf 0.8, gemini)
    pf({ fact_key: "WAGES_W2", fact_value_num: 310_134, owner_type: "DEAL", fact_type: "TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    pf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 282_742, owner_type: "DEAL", fact_type: "TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    pf({ fact_key: "TAXABLE_INCOME", fact_value_num: 249_968, owner_type: "DEAL", fact_type: "TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
  ];
}

describe("certifyPersonalIncome — cross-owner selection", () => {
  it("W-2 = 3 loses to the cross-owner W-2 = 310,134", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const w2 = getPersonalCertified(r, "WAGES_W2", 2023);
    assert.equal(w2?.status, "certified");
    assert.equal(w2?.value, 310_134);
    assert.deepEqual(w2?.sourceFactKeys, ["WAGES_W2"]);
  });

  it("AGI = 0 loses to the cross-owner AGI = 282,742", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const agi = getPersonalCertified(r, "ADJUSTED_GROSS_INCOME", 2023);
    assert.equal(agi?.status, "certified");
    assert.equal(agi?.value, 282_742);
  });

  it("TAXABLE = 456 is blocked/de-ranked; winner is the 249,968 tax-return value", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const cert = r.certifications.find((c) => c.semantic === "TAXABLE_INCOME" && c.year === 2023)!;
    assert.equal(cert.value.value, 249_968);
    const stub = cert.rejected.find((x) => x.value === 456);
    assert.ok(stub, "456 should be a recorded blocked competitor");
    assert.match(stub!.reason, /micro-stub/);
  });

  it("winner provenance prefers the DEAL / PERSONAL_TAX_RETURN family", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const cert = r.certifications.find((c) => c.semantic === "WAGES_W2" && c.year === 2023)!;
    assert.equal(cert.ownerType, "DEAL");
    assert.equal(cert.sourceFamily, "PERSONAL_TAX_RETURN");
  });
});

describe("certifyPersonalIncome — true zero + lifecycle + trace", () => {
  it("true zero is certifiable when no stronger contradictory sibling exists", () => {
    const r = certifyPersonalIncome([
      pf({ fact_key: "WAGES_W2", fact_value_num: 0, owner_type: "DEAL", fact_type: "TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    ]);
    const w2 = getPersonalCertified(r, "WAGES_W2", 2023);
    assert.equal(w2?.status, "certified");
    assert.equal(w2?.value, 0);
  });

  it("superseded / rejected / system_invalidated candidates are ignored", () => {
    const r = certifyPersonalIncome([
      // the only NON-filtered W-2 is the weak 3 → with no strong sibling it is certified;
      // prove the strong 310,134 is ignored because it is superseded/rejected/invalidated.
      pf({ fact_key: "WAGES_W2", fact_value_num: 3 }),
      pf({ fact_key: "WAGES_W2", fact_value_num: 310_134, owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: true }),
      pf({ fact_key: "WAGES_W2", fact_value_num: 320_000, owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", resolution_status: "rejected" }),
      pf({ fact_key: "WAGES_W2", fact_value_num: 330_000, owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", resolution_status: "system_invalidated" }),
    ]);
    const cert = r.certifications.find((c) => c.semantic === "WAGES_W2" && c.year === 2023)!;
    assert.equal(cert.value.value, 3); // no material sibling survived filtering → 3 stands
    assert.equal(cert.rejected.length, 0);
  });

  it("source trace is preserved for the winner and blocked competitors", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const cert = r.certifications.find((c) => c.semantic === "AGI" || c.semantic === "ADJUSTED_GROSS_INCOME")!;
    // winner carries fact id + confidence
    assert.ok(cert.value.sourceFactIds.length === 1);
    assert.equal(cert.value.confidence, 0.8);
    // blocked competitor (the 0) carries its own trace
    const zero = cert.rejected.find((x) => x.value === 0)!;
    assert.equal(zero.ownerType, "PERSONAL");
    assert.equal(zero.confidence, 0.55);
    assert.ok(zero.factId);
  });

  it("emits one audit row per certified personal-income value", () => {
    const r = certifyPersonalIncome(omniCare2023());
    const w2Audit = r.auditRows.find((a) => a.row === "WAGES_W2" && a.period === "2023-12-31")!;
    assert.equal(w2Audit.page, "personal_income");
    assert.equal(w2Audit.pass, true);
    assert.equal(w2Audit.displayedValue, 310_134);
  });
});

describe("Phase 3 purity guard", () => {
  it("certifiedPersonalIncome.ts does not import or call reconcileFinancialFacts", () => {
    const src = fs.readFileSync("src/lib/classicSpread/certification/certifiedPersonalIncome.ts", "utf8");
    // Strip comments — an explanatory prose mention of the name is fine; an import/call is not.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/\bimport\b[\s\S]*?reconcileFinancialFacts/.test(code), "must not import reconcileFinancialFacts");
    assert.ok(!/reconcileFinancialFacts\s*\(/.test(code), "must not call reconcileFinancialFacts");
    assert.ok(!/from\s+["'][^"']*certifyFactSelection["']/.test(code), "must not depend on the reconcile-backed Phase 1 selector");
  });
});
