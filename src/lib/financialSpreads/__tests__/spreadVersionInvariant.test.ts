/**
 * Spread Version Invariant — Regression Test
 *
 * Ensures enqueue placeholders always use the template registry version,
 * preventing orphaned rows from spread_version mismatches.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

// Stub "server-only" so template imports don't throw in test context.
// Point to the no-op empty.js using its absolute filesystem path.
const emptyJs = path.resolve("node_modules/server-only/empty.js");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...args: any[]
) {
  if (request === "server-only") {
    return emptyJs;
  }
  return originalResolve.call(this, request, ...args);
};

describe("spread version invariant", () => {
  it("all non-MOODYS templates exist and have numeric version >= 1", async () => {
    const { ALL_SPREAD_TYPES } = await import("../types");
    const { getSpreadTemplate } = await import("../templates");

    for (const type of ALL_SPREAD_TYPES) {
      if (type === "MOODYS") continue; // rendered via dedicated route, no standard template
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

  it("enqueue module does not hardcode spread_version", () => {
    const src = fs.readFileSync(
      "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
      "utf-8",
    );
    assert.ok(
      !src.includes("spread_version: 1"),
      "enqueueSpreadRecompute.ts still has hardcoded spread_version: 1",
    );
    assert.ok(
      src.includes("getSpreadTemplate"),
      "enqueueSpreadRecompute.ts must use getSpreadTemplate for version lookup",
    );
  });

  it("enqueue module references tpl.version from template registry", () => {
    const src = fs.readFileSync(
      "src/lib/financialSpreads/enqueueSpreadRecompute.ts",
      "utf-8",
    );
    assert.ok(
      src.includes("tpl.version"),
      "enqueueSpreadRecompute.ts must reference tpl.version from template registry",
    );
  });

  it("template versions are consistent: T12=3, BALANCE_SHEET=1, RENT_ROLL=3, GCF=3, PI=1, PFS=1", async () => {
    const { getSpreadTemplate } = await import("../templates");
    const expected: Record<string, number> = {
      T12: 3,
      BALANCE_SHEET: 1,
      RENT_ROLL: 3,
      GLOBAL_CASH_FLOW: 3,
      PERSONAL_INCOME: 1,
      PERSONAL_FINANCIAL_STATEMENT: 1,
    };
    for (const [type, expectedVersion] of Object.entries(expected)) {
      const tpl = getSpreadTemplate(type as any);
      assert.ok(tpl, `Missing template for ${type}`);
      assert.strictEqual(
        tpl.version,
        expectedVersion,
        `${type}: expected version ${expectedVersion}, got ${tpl.version}`,
      );
    }
  });
});
