/**
 * S1 — Spread Recompute Idempotency Proof
 *
 * Proves: same document type always produces same spread types;
 * routing is deterministic and exhaustive.
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

describe("Spread Recompute Idempotency Proof", () => {
  test("Scenario A: spreadsForDocType determinism — exhaustive enumeration", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    // SPEC-CREDIT-MEMO-NON-T12-FINANCIAL-PATH-INTEGRITY-1: annual operating/financial
    // statements no longer enqueue a spread — their figures materialize as canonical
    // facts via extraction. T12 is never enqueued from these doc types.
    const noSpread = ["FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT"];
    for (const dt of noSpread) {
      assert.deepStrictEqual(
        spreadsForDocType(dt),
        [],
        `${dt} must map to [] (no T12; annual facts come from extraction)`,
      );
    }

    // Balance sheet
    assert.deepStrictEqual(
      spreadsForDocType("BALANCE_SHEET"),
      ["BALANCE_SHEET"],
      "BALANCE_SHEET must map to [BALANCE_SHEET]",
    );

    // Rent roll
    assert.deepStrictEqual(
      spreadsForDocType("RENT_ROLL"),
      ["RENT_ROLL"],
      "RENT_ROLL must map to [RENT_ROLL]",
    );

    // Business tax returns → GCF only (repayment); no T12. Annual figures come from
    // extraction, not a spread.
    const businessTax = ["IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN"];
    for (const dt of businessTax) {
      assert.deepStrictEqual(
        spreadsForDocType(dt),
        ["GLOBAL_CASH_FLOW"],
        `${dt} must map to [GLOBAL_CASH_FLOW] (no T12)`,
      );
    }

    // Personal tax returns → PI + GCF
    const personalTax = ["IRS_1040", "IRS_PERSONAL", "PERSONAL_TAX_RETURN"];
    for (const dt of personalTax) {
      assert.deepStrictEqual(
        spreadsForDocType(dt),
        ["PERSONAL_INCOME", "GLOBAL_CASH_FLOW"],
        `${dt} must map to [PERSONAL_INCOME, GLOBAL_CASH_FLOW]`,
      );
    }

    // PFS → PFS + GCF
    const pfsDocs = ["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"];
    for (const dt of pfsDocs) {
      assert.deepStrictEqual(
        spreadsForDocType(dt),
        ["PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"],
        `${dt} must map to [PERSONAL_FINANCIAL_STATEMENT, GLOBAL_CASH_FLOW]`,
      );
    }
  });

  test("Scenario B: Unknown doc type → empty array", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    assert.deepStrictEqual(spreadsForDocType("UNKNOWN"), [], "UNKNOWN → []");
    assert.deepStrictEqual(spreadsForDocType(""), [], "empty string → []");
    assert.deepStrictEqual(spreadsForDocType(null as any), [], "null → []");
    assert.deepStrictEqual(spreadsForDocType(undefined as any), [], "undefined → []");
    assert.deepStrictEqual(spreadsForDocType("DRIVERS_LICENSE"), [], "DRIVERS_LICENSE → []");
  });

  test("Scenario C: Case insensitivity", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    assert.deepStrictEqual(
      spreadsForDocType("t12"),
      spreadsForDocType("T12"),
      "t12 must equal T12",
    );
    assert.deepStrictEqual(
      spreadsForDocType("rent_roll"),
      spreadsForDocType("RENT_ROLL"),
      "rent_roll must equal RENT_ROLL",
    );
    assert.deepStrictEqual(
      spreadsForDocType("Balance_Sheet"),
      spreadsForDocType("BALANCE_SHEET"),
      "Balance_Sheet must equal BALANCE_SHEET",
    );
    assert.deepStrictEqual(
      spreadsForDocType("irs_1040"),
      spreadsForDocType("IRS_1040"),
      "irs_1040 must equal IRS_1040",
    );
  });

  test("Scenario D: Idempotency — calling twice with same input → identical result", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    const representatives = ["T12", "RENT_ROLL", "IRS_1040", "BUSINESS_TAX_RETURN", "PFS"];
    for (const dt of representatives) {
      const r1 = spreadsForDocType(dt);
      const r2 = spreadsForDocType(dt);
      assert.deepStrictEqual(r1, r2, `spreadsForDocType("${dt}") must be idempotent`);
    }
  });

  test("Scenario E: No doc type maps to STANDARD", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    const allDocTypes = [
      "FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT",
      "BALANCE_SHEET", "RENT_ROLL",
      "IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN",
      "IRS_1040", "IRS_PERSONAL", "PERSONAL_TAX_RETURN",
      "PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413",
    ];

    for (const dt of allDocTypes) {
      const result = spreadsForDocType(dt);
      assert.ok(
        !result.includes("STANDARD" as any),
        `${dt} must NOT map to STANDARD`,
      );
    }
  });

  test("Scenario F: GCF reachability — multiple doc types lead to GLOBAL_CASH_FLOW", async () => {
    const { spreadsForDocType } = await import(
      "@/lib/financialSpreads/docTypeToSpreadTypes"
    );

    const allDocTypes = [
      "FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT",
      "BALANCE_SHEET", "RENT_ROLL",
      "IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN",
      "IRS_1040", "IRS_PERSONAL", "PERSONAL_TAX_RETURN",
      "PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413",
    ];

    let gcfCount = 0;
    for (const dt of allDocTypes) {
      if (spreadsForDocType(dt).includes("GLOBAL_CASH_FLOW")) {
        gcfCount++;
      }
    }

    assert.ok(
      gcfCount >= 3,
      `At least 3 doc types must lead to GLOBAL_CASH_FLOW (got ${gcfCount})`,
    );
  });

  test("Scenario G: Enqueue source uses spreadsForDocType or canonical routing", () => {
    const src = readSource(
      "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
    );
    // enqueueSpreadRecompute receives spreadTypes as argument — it doesn't call spreadsForDocType directly.
    // The routing is done by callers (classifyProcessor, processArtifact).
    // Verify the enqueue function validates against template registry.
    assert.ok(
      src.includes("getSpreadTemplate"),
      "enqueueSpreadRecompute must validate types against template registry",
    );
    assert.ok(
      src.includes("validTypes") && src.includes("invalidTypes"),
      "enqueueSpreadRecompute must split into validTypes/invalidTypes",
    );
  });
});
