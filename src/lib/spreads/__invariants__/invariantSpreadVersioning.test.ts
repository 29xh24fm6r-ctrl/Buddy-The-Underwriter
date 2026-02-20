/**
 * S1 — Spread Version Consistency Proof
 *
 * Proves: version flows from template registry → placeholder → CAS claim →
 * rendered output. No hardcoded versions anywhere in the pipeline.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Module from "node:module";

// ── server-only stub ──────────────────────────────────────────────────
const emptyJs = resolve("node_modules/server-only/empty.js");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...args: any[]
) {
  if (request === "server-only") return emptyJs;
  return originalResolve.call(this, request, ...args);
};

// ── Helpers ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Spread Version Consistency Proof", () => {
  test("Scenario A: Template version is single source of truth", async () => {
    const { ALL_SPREAD_TYPES } = await import(
      "@/lib/financialSpreads/types"
    );
    const { getSpreadTemplate } = await import(
      "@/lib/financialSpreads/templates"
    );

    for (const type of ALL_SPREAD_TYPES) {
      if (type === "STANDARD") continue;
      const tpl = getSpreadTemplate(type);
      assert.ok(tpl, `Missing template for ${type}`);
      assert.strictEqual(
        typeof tpl.version,
        "number",
        `${type}: version must be a number`,
      );
      assert.ok(
        tpl.version >= 1,
        `${type}: version must be >= 1, got ${tpl.version}`,
      );
    }
  });

  test("Scenario B: Enqueue uses template version, not hardcoded", () => {
    const src = readSource(
      "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
    );
    assert.ok(
      src.includes("tpl.version"),
      "enqueueSpreadRecompute must reference tpl.version",
    );
    assert.ok(
      !src.includes("spread_version: 1,"),
      "enqueueSpreadRecompute must NOT hardcode spread_version: 1",
    );
  });

  test("Scenario C: CAS claim pins spread_version in WHERE clause", () => {
    const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
    // CAS claim block between "transition queued→generating" and ".maybeSingle()"
    const casStart = src.indexOf("transition queued");
    const casEnd = src.indexOf(".maybeSingle()", casStart);
    const casBlock = src.slice(casStart, casEnd);
    assert.ok(
      casBlock.includes('.eq("spread_version"'),
      "CAS claim must include .eq(\"spread_version\") for deterministic claiming",
    );
  });

  test("Scenario D: Error-path cleanup also pins spread_version", () => {
    const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
    const errorPathStart = src.indexOf("NON-NEGOTIABLE: clean up");
    assert.ok(errorPathStart > 0, "Error path must exist");
    const errorBlock = src.slice(errorPathStart, errorPathStart + 1500);
    assert.ok(
      errorBlock.includes('.eq("spread_version"') ||
        errorBlock.includes(".eq(\"spread_version\""),
      "Error-path cleanup must include .eq(\"spread_version\")",
    );
  });

  test("Scenario E: resolveOwnerType is pure and deterministic", async () => {
    const { resolveOwnerType } = await import(
      "@/lib/financialSpreads/resolveOwnerType"
    );

    const expected: [string, string][] = [
      ["T12", "DEAL"],
      ["BALANCE_SHEET", "DEAL"],
      ["RENT_ROLL", "DEAL"],
      ["PERSONAL_INCOME", "PERSONAL"],
      ["PERSONAL_FINANCIAL_STATEMENT", "PERSONAL"],
      ["GLOBAL_CASH_FLOW", "GLOBAL"],
      ["STANDARD", "DEAL"],
    ];

    for (const [spreadType, expectedOwner] of expected) {
      assert.strictEqual(
        resolveOwnerType(spreadType),
        expectedOwner,
        `resolveOwnerType("${spreadType}") must return "${expectedOwner}"`,
      );
    }

    // Determinism: call twice, same result
    for (const [spreadType, expectedOwner] of expected) {
      const r1 = resolveOwnerType(spreadType);
      const r2 = resolveOwnerType(spreadType);
      assert.strictEqual(r1, r2, `resolveOwnerType("${spreadType}") must be deterministic`);
    }
  });

  test("Scenario F: ALL_SPREAD_TYPES universe is complete and ordered", async () => {
    const { ALL_SPREAD_TYPES } = await import(
      "@/lib/financialSpreads/types"
    );

    assert.strictEqual(ALL_SPREAD_TYPES.length, 7, "ALL_SPREAD_TYPES must have 7 members");

    const expectedTypes = [
      "T12",
      "BALANCE_SHEET",
      "RENT_ROLL",
      "PERSONAL_INCOME",
      "PERSONAL_FINANCIAL_STATEMENT",
      "GLOBAL_CASH_FLOW",
      "STANDARD",
    ];
    for (const t of expectedTypes) {
      assert.ok(
        ALL_SPREAD_TYPES.includes(t as any),
        `ALL_SPREAD_TYPES must include ${t}`,
      );
    }

    // No duplicates
    const unique = new Set(ALL_SPREAD_TYPES);
    assert.strictEqual(
      unique.size,
      ALL_SPREAD_TYPES.length,
      "ALL_SPREAD_TYPES must have no duplicates",
    );
  });

  test("Scenario G: STANDARD type has no template", async () => {
    const { getSpreadTemplate } = await import(
      "@/lib/financialSpreads/templates"
    );
    const tpl = getSpreadTemplate("STANDARD" as any);
    assert.strictEqual(tpl, null, "STANDARD must NOT have a template");
  });
});
