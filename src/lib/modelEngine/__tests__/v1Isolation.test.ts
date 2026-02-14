/**
 * Phase 11 — V1 Isolation Guard
 *
 * Static analysis tests: verifies no user-facing route imports V1 renderer,
 * engineAuthority does not call V1, and deal_spreads writes use envelope format.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("V1 Isolation — User Routes", () => {
  it("standard route does NOT import renderStandardSpread", () => {
    const src = readSource("src/app/api/deals/[dealId]/spreads/standard/route.ts");
    assert.ok(
      !src.includes("renderStandardSpread"),
      "Standard route must not import V1 renderer (renderStandardSpread)",
    );
  });

  it("standard route does NOT import renderStandardSpreadWithValidation", () => {
    const src = readSource("src/app/api/deals/[dealId]/spreads/standard/route.ts");
    assert.ok(
      !src.includes("renderStandardSpreadWithValidation"),
      "Standard route must not import V1 renderer (renderStandardSpreadWithValidation)",
    );
  });

  it("standard route does NOT import computeLegacyComparison", () => {
    const src = readSource("src/app/api/deals/[dealId]/spreads/standard/route.ts");
    assert.ok(
      !src.includes("computeLegacyComparison"),
      "Standard route must not import legacy comparison",
    );
  });

  it("standard route does NOT import renderFromLegacySpread", () => {
    const src = readSource("src/app/api/deals/[dealId]/spreads/standard/route.ts");
    assert.ok(
      !src.includes("renderFromLegacySpread"),
      "Standard route must not import V1 adapter",
    );
  });

  it("standard route does NOT contain fallbackUsed", () => {
    const src = readSource("src/app/api/deals/[dealId]/spreads/standard/route.ts");
    assert.ok(
      !src.includes("fallbackUsed"),
      "Standard route must not have V1 fallback logic",
    );
  });

  it("underwrite route does NOT contain fallbackUsed", () => {
    const src = readSource("src/app/api/deals/[dealId]/underwrite/route.ts");
    assert.ok(
      !src.includes("fallbackUsed"),
      "Underwrite route must not have V1 fallback logic",
    );
  });

  it("underwrite route does NOT import selectModelEngineMode", () => {
    const src = readSource("src/app/api/deals/[dealId]/underwrite/route.ts");
    assert.ok(
      !src.includes("selectModelEngineMode"),
      "Underwrite route must not import mode selector",
    );
  });
});

describe("V1 Isolation — Engine Authority", () => {
  it("computeAuthoritativeEngine does NOT call renderStandardSpreadWithValidation", () => {
    const src = readSource("src/lib/modelEngine/engineAuthority.ts");
    // The function call pattern (not just import for legacy comparison)
    const lines = src.split("\n");
    const authorityFnStart = lines.findIndex((l) => l.includes("async function computeAuthoritativeEngine"));
    const authorityFnEnd = lines.findIndex((l, i) => i > authorityFnStart && /^}/.test(l));
    const authorityBody = lines.slice(authorityFnStart, authorityFnEnd + 1).join("\n");

    assert.ok(
      !authorityBody.includes("renderStandardSpreadWithValidation("),
      "computeAuthoritativeEngine must not call V1 renderer",
    );
  });

  it("AuthoritativeResult type does NOT include renderedSpread", () => {
    const src = readSource("src/lib/modelEngine/engineAuthority.ts");
    // Extract the AuthoritativeResult interface
    const match = src.match(/export interface AuthoritativeResult \{[\s\S]*?\n\}/);
    assert.ok(match, "AuthoritativeResult interface must exist");
    assert.ok(
      !match[0].includes("renderedSpread"),
      "AuthoritativeResult must not have renderedSpread field",
    );
  });
});

describe("V1 Isolation — Persistence Envelope", () => {
  it("deal_spreads write uses envelope format with engine field", () => {
    const src = readSource("src/lib/modelEngine/engineAuthority.ts");
    // Look for the envelope pattern in persistence
    assert.ok(
      src.includes('engine: "v2_authoritative"'),
      "deal_spreads persistence must include engine envelope",
    );
    assert.ok(
      src.includes("schema_version: 2"),
      "deal_spreads persistence must include schema_version: 2",
    );
    assert.ok(
      src.includes("payload: viewModel"),
      "deal_spreads persistence must include payload: viewModel",
    );
  });
});

describe("V1 Isolation — Print Page", () => {
  it("print page does NOT import renderStandardSpread", () => {
    const src = readSource("src/app/(app)/deals/[dealId]/spreads/standard/print/page.tsx");
    assert.ok(
      !src.includes("renderStandardSpread"),
      "Print page must not import V1 renderer directly",
    );
  });

  it("print page uses V2 pipeline (buildFinancialModel + renderFromFinancialModel)", () => {
    const src = readSource("src/app/(app)/deals/[dealId]/spreads/standard/print/page.tsx");
    assert.ok(
      src.includes("buildFinancialModel"),
      "Print page must use V2 buildFinancialModel",
    );
    assert.ok(
      src.includes("renderFromFinancialModel"),
      "Print page must use V2 renderFromFinancialModel",
    );
    assert.ok(
      src.includes("viewModelToRenderedSpread"),
      "Print page must use viewModelToRenderedSpread adapter",
    );
  });
});

describe("V1 Isolation — UI Page", () => {
  it("standard UI page does NOT import MultiPeriodSpreadTable", () => {
    const src = readSource("src/app/(app)/deals/[dealId]/spreads/standard/page.tsx");
    assert.ok(
      !src.includes("MultiPeriodSpreadTable"),
      "Standard UI page must not import V1 table component",
    );
  });

  it("standard UI page does NOT contain V2 Shadow Active", () => {
    const src = readSource("src/app/(app)/deals/[dealId]/spreads/standard/page.tsx");
    assert.ok(
      !src.includes("V2 Shadow Active"),
      "Standard UI page must not have shadow badge",
    );
  });

  it("standard UI page does NOT read json.spread", () => {
    const src = readSource("src/app/(app)/deals/[dealId]/spreads/standard/page.tsx");
    assert.ok(
      !src.includes("json.spread"),
      "Standard UI page must not consume V1 spread from API",
    );
  });
});

describe("V1 Isolation — Barrel Exports", () => {
  it("index.ts does NOT export isModelEngineV2Enabled", () => {
    const src = readSource("src/lib/modelEngine/index.ts");
    assert.ok(
      !src.includes("isModelEngineV2Enabled"),
      "Barrel must not export deprecated isModelEngineV2Enabled",
    );
  });

  it("index.ts does NOT export selectModelEngineMode as value", () => {
    const src = readSource("src/lib/modelEngine/index.ts");
    // Check there's no value export of selectModelEngineMode (type-only is OK)
    const lines = src.split("\n");
    const valueExportLines = lines.filter(
      (l) => l.includes("selectModelEngineMode") && !l.trim().startsWith("export type") && !l.trim().startsWith("//"),
    );
    assert.equal(
      valueExportLines.length,
      0,
      "Barrel must not value-export selectModelEngineMode",
    );
  });
});

describe("V1 Isolation — Mode Selector Enforcement", () => {
  it("selectModelEngineMode returns v2_primary when isOpsOverride is false", async () => {
    const { selectModelEngineMode, _resetAllowlistCache } = await import("../modeSelector");
    const saved = process.env.MODEL_ENGINE_PRIMARY;
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    _resetAllowlistCache();

    const result = selectModelEngineMode({ isOpsOverride: false });
    assert.equal(result.mode, "v2_primary", "Non-ops context must always get v2_primary");
    assert.equal(result.reason, "enforced");

    if (saved === undefined) delete process.env.MODEL_ENGINE_PRIMARY;
    else process.env.MODEL_ENGINE_PRIMARY = saved;
    _resetAllowlistCache();
  });

  it("selectModelEngineMode respects MODEL_ENGINE_PRIMARY=V1 when isOpsOverride is true", async () => {
    const { selectModelEngineMode, _resetAllowlistCache } = await import("../modeSelector");
    const saved = process.env.MODEL_ENGINE_PRIMARY;
    process.env.MODEL_ENGINE_PRIMARY = "V1";
    _resetAllowlistCache();

    const result = selectModelEngineMode({ isOpsOverride: true });
    assert.equal(result.mode, "v1", "Ops context should respect MODEL_ENGINE_PRIMARY=V1");

    if (saved === undefined) delete process.env.MODEL_ENGINE_PRIMARY;
    else process.env.MODEL_ENGINE_PRIMARY = saved;
    _resetAllowlistCache();
  });
});
