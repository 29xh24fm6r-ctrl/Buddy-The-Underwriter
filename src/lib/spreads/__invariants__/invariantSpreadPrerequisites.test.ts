/**
 * S1 — Spread Prerequisite Determinism Proof
 *
 * Proves: evaluatePrereq() is deterministic, prerequisite contracts
 * are complete, priority ordering is correct.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Spread Prerequisite Determinism Proof", () => {
  test("Scenario A: evaluatePrereq — all facts present → ready", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      { facts: { fact_types: ["INCOME_STATEMENT"] } },
      { byFactType: { INCOME_STATEMENT: 5 }, total: 5 } as any,
      0,
    );

    assert.strictEqual(result.ready, true, "Must be ready when all facts present");
    assert.strictEqual(result.missing.length, 0, "No missing items");
  });

  test("Scenario B: evaluatePrereq — missing fact type → not ready with specific missing", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      { facts: { fact_types: ["INCOME_STATEMENT", "TAX_RETURN"] } },
      { byFactType: { INCOME_STATEMENT: 5 }, total: 5 } as any,
      0,
    );

    assert.strictEqual(result.ready, false, "Must not be ready with missing fact");
    assert.ok(
      result.missing.includes("fact_type:TAX_RETURN"),
      "Must report fact_type:TAX_RETURN as missing",
    );
  });

  test("Scenario C: evaluatePrereq — rent_roll_rows required, count 0 → not ready", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      { tables: { rent_roll_rows: true } },
      { byFactType: {}, total: 0 } as any,
      0,
    );

    assert.strictEqual(result.ready, false, "Must not be ready with 0 rent_roll_rows");
    assert.ok(
      result.missing.includes("table:rent_roll_rows"),
      "Must report table:rent_roll_rows as missing",
    );
  });

  test("Scenario D: evaluatePrereq — rent_roll_rows required, count > 0 → ready", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      { tables: { rent_roll_rows: true } },
      { byFactType: {}, total: 0 } as any,
      10,
    );

    assert.strictEqual(result.ready, true, "Must be ready with 10 rent_roll_rows");
    assert.strictEqual(result.missing.length, 0, "No missing items");
  });

  test("Scenario E: evaluatePrereq — empty prereq → always ready", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      {},
      { byFactType: {}, total: 0 } as any,
      0,
    );

    assert.strictEqual(result.ready, true, "Empty prereq must always be ready");
    assert.strictEqual(result.missing.length, 0, "No missing items");
  });

  test("Scenario F: evaluatePrereq — multiple missing → all reported", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const result = evaluatePrereq(
      {
        facts: { fact_types: ["INCOME_STATEMENT", "BALANCE_SHEET"] },
        tables: { rent_roll_rows: true },
      },
      { byFactType: {}, total: 0 } as any,
      0,
    );

    assert.strictEqual(result.ready, false, "Must not be ready");
    assert.ok(result.missing.length >= 3, `Must report at least 3 missing (got ${result.missing.length})`);
    assert.ok(result.missing.includes("fact_type:INCOME_STATEMENT"));
    assert.ok(result.missing.includes("fact_type:BALANCE_SHEET"));
    assert.ok(result.missing.includes("table:rent_roll_rows"));
  });

  test("Scenario G: Priority ordering is deterministic", () => {
    const templateFiles = [
      { name: "T12", path: "src/lib/financialSpreads/templates/t12.ts", priority: 10 },
      { name: "BALANCE_SHEET", path: "src/lib/financialSpreads/templates/balanceSheet.ts", priority: 20 },
      { name: "PERSONAL_INCOME", path: "src/lib/financialSpreads/templates/personalIncome.ts", priority: 30 },
      { name: "PERSONAL_FINANCIAL_STATEMENT", path: "src/lib/financialSpreads/templates/personalFinancialStatement.ts", priority: 40 },
      { name: "RENT_ROLL", path: "src/lib/financialSpreads/templates/rentRoll.ts", priority: 50 },
      { name: "GLOBAL_CASH_FLOW", path: "src/lib/financialSpreads/templates/globalCashFlow.ts", priority: 90 },
    ];

    for (const { name, path, priority } of templateFiles) {
      const src = readSource(path);
      assert.ok(
        src.includes(`priority: ${priority}`),
        `${name} must have priority: ${priority}`,
      );
    }

    // Verify ordering: each priority < next
    for (let i = 0; i < templateFiles.length - 1; i++) {
      assert.ok(
        templateFiles[i].priority < templateFiles[i + 1].priority,
        `${templateFiles[i].name}(${templateFiles[i].priority}) must be < ${templateFiles[i + 1].name}(${templateFiles[i + 1].priority})`,
      );
    }
  });

  test("Scenario H: Priority sort applied in processor", () => {
    const processorSrc = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
    assert.ok(
      processorSrc.includes("requested.sort"),
      "spreadsProcessor must sort requested types",
    );
    assert.ok(
      processorSrc.includes("getSpreadTemplate(a)?.priority"),
      "spreadsProcessor must sort by template priority",
    );
  });

  test("Scenario I: evaluatePrereq determinism — same input → same output (5 reps)", async () => {
    const { evaluatePrereq } = await import(
      "@/lib/financialSpreads/evaluatePrereq"
    );

    const prereq = {
      facts: { fact_types: ["INCOME_STATEMENT"] },
      tables: { rent_roll_rows: true },
    };
    const factsVis = { byFactType: { INCOME_STATEMENT: 3 }, total: 3 } as any;

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(evaluatePrereq(prereq, factsVis, 5));
    }

    for (let i = 1; i < results.length; i++) {
      assert.deepStrictEqual(
        results[i],
        results[0],
        `Rep ${i + 1} must equal rep 1`,
      );
    }
  });
});
