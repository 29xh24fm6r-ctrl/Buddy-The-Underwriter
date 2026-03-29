import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── G. Guard tests (57–66) ──────────────────────────────────────────────────

const PURE_FILES = [
  "deriveCryptoCollateralValue.ts",
  "deriveCryptoCurrentLtv.ts",
  "deriveCryptoThresholdState.ts",
  "buildCryptoMonitoringCadence.ts",
  "deriveCryptoReasonCodes.ts",
  "deriveCryptoRelationshipStatus.ts",
  "deriveCryptoCollateralHealth.ts",
  "deriveCryptoProtectionReadiness.ts",
  "deriveCryptoNextActions.ts",
  "buildCryptoExplanations.ts",
  "cryptoTypes.ts",
];

const RELATIONSHIP_DIR = path.resolve(__dirname, "..");

function readPureFile(name: string): string {
  return fs.readFileSync(path.join(RELATIONSHIP_DIR, name), "utf-8");
}

describe("Crypto guard tests", () => {
  it("57. no DB imports in pure crypto files", () => {
    for (const file of PURE_FILES) {
      const content = readPureFile(file);
      assert.ok(
        !content.includes("supabaseAdmin"),
        `${file} must not import supabaseAdmin`,
      );
      assert.ok(
        !content.includes("@/lib/supabase"),
        `${file} must not import from @/lib/supabase`,
      );
    }
  });

  it("58. no server-only imports in pure files", () => {
    for (const file of PURE_FILES) {
      const content = readPureFile(file);
      assert.ok(
        !content.includes('"server-only"'),
        `${file} must not import server-only`,
      );
    }
  });

  it("59. no Math.random in pure files", () => {
    for (const file of PURE_FILES) {
      const content = readPureFile(file);
      assert.ok(
        !content.includes("Math.random"),
        `${file} must not use Math.random`,
      );
    }
  });

  it("60. no fetch in pure files", () => {
    for (const file of PURE_FILES) {
      const content = readPureFile(file);
      // Allow "fetch" in comments/strings but not as standalone function call
      const lines = content.split("\n").filter(
        (l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"),
      );
      const nonCommentContent = lines.join("\n");
      assert.ok(
        !nonCommentContent.match(/\bfetch\s*\(/),
        `${file} must not use fetch()`,
      );
    }
  });

  it("61. no Date.now in pure derivation files (except types)", () => {
    const derivationFiles = PURE_FILES.filter((f) => f !== "cryptoTypes.ts");
    for (const file of derivationFiles) {
      const content = readPureFile(file);
      assert.ok(
        !content.includes("Date.now"),
        `${file} must not use Date.now — inject time as parameter`,
      );
    }
  });

  it("62. no automatic liquidation execution in pure derivation files", () => {
    // Types file may define the enum value; derivation files must not produce it
    const derivationFiles = PURE_FILES.filter((f) => f !== "cryptoTypes.ts");
    for (const file of derivationFiles) {
      const content = readPureFile(file);
      assert.ok(
        !content.includes("liquidation_executed"),
        `${file} must not contain liquidation_executed — requires human gate`,
      );
    }
  });

  it("63. types file has zero runtime imports", () => {
    const content = readPureFile("cryptoTypes.ts");
    assert.ok(
      !content.includes('from "'),
      "cryptoTypes.ts must have zero runtime imports (only type definitions)",
    );
    // Allow relative type imports
    const importLines = content.split("\n").filter((l) => l.startsWith("import ") && !l.includes("type"));
    assert.equal(
      importLines.length,
      0,
      `cryptoTypes.ts has non-type imports: ${importLines.join(", ")}`,
    );
  });

  it("64. deriveCryptoCollateralValue is deterministic (100 iterations)", () => {
    const { deriveCryptoCollateralValue } = require("../deriveCryptoCollateralValue");
    const input = {
      pledgedUnits: 10,
      referencePriceUsd: 50000,
      haircutPercent: 0.20,
      eligibleAdvanceRate: 0.85,
    };
    const first = deriveCryptoCollateralValue(input);
    for (let i = 0; i < 100; i++) {
      const result = deriveCryptoCollateralValue(input);
      assert.deepEqual(result, first, `Iteration ${i} differs`);
    }
  });

  it("65. deriveCryptoThresholdState is deterministic (100 iterations)", () => {
    const { deriveCryptoThresholdState } = require("../deriveCryptoThresholdState");
    const input = {
      currentLtv: 0.82,
      warningLtvThreshold: 0.70,
      marginCallLtvThreshold: 0.80,
      liquidationLtvThreshold: 0.90,
    };
    const first = deriveCryptoThresholdState(input);
    for (let i = 0; i < 100; i++) {
      assert.equal(deriveCryptoThresholdState(input), first, `Iteration ${i} differs`);
    }
  });

  it("66. append-only event discipline — logRelationshipCryptoEvent uses INSERT only", () => {
    const content = fs.readFileSync(
      path.join(RELATIONSHIP_DIR, "logRelationshipCryptoEvent.ts"),
      "utf-8",
    );
    assert.ok(content.includes(".insert("), "logRelationshipCryptoEvent must use .insert()");
    assert.ok(!content.includes(".update("), "logRelationshipCryptoEvent must not use .update()");
    assert.ok(!content.includes(".delete("), "logRelationshipCryptoEvent must not use .delete()");
  });
});
