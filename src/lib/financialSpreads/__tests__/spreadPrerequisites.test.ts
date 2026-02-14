/**
 * Spread Prerequisites — Invariant Tests
 *
 * Every template MUST define:
 * - priority: number (deterministic ordering)
 * - prerequisites(): SpreadPrereq (fact/table readiness contract)
 *
 * Ordering: T12(10) < BS(20) < PI(30) < PFS(40) < RR(50) < GCF(90)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("spread prerequisites", () => {
  // Read all template source files
  const t12Src = fs.readFileSync("src/lib/financialSpreads/templates/t12.ts", "utf-8");
  const bsSrc = fs.readFileSync("src/lib/financialSpreads/templates/balanceSheet.ts", "utf-8");
  const piSrc = fs.readFileSync("src/lib/financialSpreads/templates/personalIncome.ts", "utf-8");
  const pfsSrc = fs.readFileSync("src/lib/financialSpreads/templates/personalFinancialStatement.ts", "utf-8");
  const rrSrc = fs.readFileSync("src/lib/financialSpreads/templates/rentRoll.ts", "utf-8");
  const gcfSrc = fs.readFileSync("src/lib/financialSpreads/templates/globalCashFlow.ts", "utf-8");
  const templateTypesSrc = fs.readFileSync("src/lib/financialSpreads/templates/templateTypes.ts", "utf-8");
  const evaluatePrereqSrc = fs.readFileSync("src/lib/financialSpreads/evaluatePrereq.ts", "utf-8");

  const allTemplates = [
    { name: "T12", src: t12Src },
    { name: "BALANCE_SHEET", src: bsSrc },
    { name: "PERSONAL_INCOME", src: piSrc },
    { name: "PERSONAL_FINANCIAL_STATEMENT", src: pfsSrc },
    { name: "RENT_ROLL", src: rrSrc },
    { name: "GLOBAL_CASH_FLOW", src: gcfSrc },
  ];

  it("SpreadTemplate type requires priority and prerequisites", () => {
    assert.ok(
      templateTypesSrc.includes("priority: number"),
      "SpreadTemplate must include priority: number",
    );
    assert.ok(
      templateTypesSrc.includes("prerequisites: () => SpreadPrereq"),
      "SpreadTemplate must include prerequisites: () => SpreadPrereq",
    );
  });

  it("SpreadPrereq type is defined with facts, tables, note", () => {
    assert.ok(
      templateTypesSrc.includes("SpreadPrereq"),
      "templateTypes must export SpreadPrereq",
    );
    assert.ok(
      templateTypesSrc.includes("fact_types"),
      "SpreadPrereq must support fact_types",
    );
    assert.ok(
      templateTypesSrc.includes("fact_keys"),
      "SpreadPrereq must support fact_keys",
    );
    assert.ok(
      templateTypesSrc.includes("rent_roll_rows"),
      "SpreadPrereq must support tables.rent_roll_rows",
    );
    assert.ok(
      templateTypesSrc.includes("note"),
      "SpreadPrereq must support note",
    );
  });

  it("all non-STANDARD templates define priority and prerequisites", () => {
    for (const { name, src } of allTemplates) {
      assert.ok(
        src.includes("priority:"),
        `${name} template must define priority`,
      );
      assert.ok(
        src.includes("prerequisites:"),
        `${name} template must define prerequisites`,
      );
    }
  });

  it("priorities match expected values: T12=10, BS=20, PI=30, PFS=40, RR=50, GCF=90", () => {
    const expected: [string, string, number][] = [
      ["T12", t12Src, 10],
      ["BALANCE_SHEET", bsSrc, 20],
      ["PERSONAL_INCOME", piSrc, 30],
      ["PERSONAL_FINANCIAL_STATEMENT", pfsSrc, 40],
      ["RENT_ROLL", rrSrc, 50],
      ["GLOBAL_CASH_FLOW", gcfSrc, 90],
    ];

    for (const [name, src, priority] of expected) {
      assert.ok(
        src.includes(`priority: ${priority}`),
        `${name} must have priority: ${priority}`,
      );
    }
  });

  it("GCF has empty prerequisites (always renderable with partials)", () => {
    // GCF should NOT require any specific fact_types
    assert.ok(
      !gcfSrc.includes("fact_types:"),
      "GCF prerequisites should NOT require specific fact_types",
    );
    assert.ok(
      !gcfSrc.includes("rent_roll_rows:"),
      "GCF prerequisites should NOT require rent_roll_rows",
    );
    assert.ok(
      gcfSrc.includes("always renderable"),
      "GCF should note it's always renderable with partials",
    );
  });

  it("T12 requires INCOME_STATEMENT and TAX_RETURN facts", () => {
    assert.ok(
      t12Src.includes("INCOME_STATEMENT"),
      "T12 template prerequisites must reference INCOME_STATEMENT fact type",
    );
    assert.ok(
      t12Src.includes("TAX_RETURN"),
      "T12 template prerequisites must also reference TAX_RETURN fact type (business tax returns feed operating performance)",
    );
  });

  it("BALANCE_SHEET requires BALANCE_SHEET facts", () => {
    assert.ok(
      bsSrc.includes('fact_types: ["BALANCE_SHEET"]'),
      "Balance sheet template prerequisites must reference BALANCE_SHEET fact type",
    );
  });

  it("RENT_ROLL requires rent_roll_rows table", () => {
    assert.ok(
      rrSrc.includes("rent_roll_rows: true"),
      "Rent roll template prerequisites must require rent_roll_rows",
    );
  });

  it("evaluatePrereq module exists and handles fact_types + tables + empty prereqs", () => {
    assert.ok(
      evaluatePrereqSrc.includes("export function evaluatePrereq"),
      "evaluatePrereq must be an exported function",
    );
    assert.ok(
      evaluatePrereqSrc.includes("fact_types"),
      "evaluatePrereq must check fact_types",
    );
    assert.ok(
      evaluatePrereqSrc.includes("rent_roll_rows"),
      "evaluatePrereq must check rent_roll_rows",
    );
    assert.ok(
      evaluatePrereqSrc.includes("ready"),
      "evaluatePrereq must return ready status",
    );
    assert.ok(
      evaluatePrereqSrc.includes("missing"),
      "evaluatePrereq must return missing list",
    );
  });

  it("priority sort is applied in spreadsProcessor", () => {
    const processorSrc = fs.readFileSync(
      "src/lib/jobs/processors/spreadsProcessor.ts",
      "utf-8",
    );
    assert.ok(
      processorSrc.includes("requested.sort"),
      "spreadsProcessor must sort requested types",
    );
    assert.ok(
      processorSrc.includes("getSpreadTemplate(a)?.priority"),
      "spreadsProcessor must sort by template priority",
    );
  });
});
