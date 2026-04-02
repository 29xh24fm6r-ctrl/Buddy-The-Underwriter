/**
 * Borrower Insights Contract Guards
 *
 * Ensures the borrower insights wiring stays correct:
 * - Page fetches correct route
 * - GET and POST use shared formatters
 * - Persistence stores full canonical payload
 *
 * Run with: node --import tsx --test src/lib/borrowerReport/__tests__/contractsGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

// ============================================================================
// Guard 1: contracts.ts exists with formatters
// ============================================================================

describe("Guard 1: Canonical contract module", () => {
  const contractsPath = join(ROOT, "src/lib/borrowerReport/contracts.ts");

  it("contracts.ts exists", () => {
    assert.ok(existsSync(contractsPath));
  });

  it("exports toBorrowerInsightsApiResponse", () => {
    const code = readFileSync(contractsPath, "utf-8");
    assert.ok(code.includes("export function toBorrowerInsightsApiResponse"));
  });

  it("exports borrowerInsightRunRowToApiResponse", () => {
    const code = readFileSync(contractsPath, "utf-8");
    assert.ok(code.includes("export function borrowerInsightRunRowToApiResponse"));
  });

  it("exports BorrowerInsightsApiResponse type", () => {
    const code = readFileSync(contractsPath, "utf-8");
    assert.ok(code.includes("export type BorrowerInsightsApiResponse"));
  });

  it("handles incomplete persisted rows with console.warn", () => {
    const code = readFileSync(contractsPath, "utf-8");
    assert.ok(code.includes("incomplete persisted payload"));
  });
});

// ============================================================================
// Guard 2: Page fetches correct route
// ============================================================================

describe("Guard 2: Page route correctness", () => {
  const pagePath = join(ROOT, "src/app/(app)/deals/[dealId]/insights/page.tsx");

  it("page fetches /borrower-insights not /insights", () => {
    const code = readFileSync(pagePath, "utf-8");
    assert.ok(
      code.includes("/borrower-insights"),
      "Page must fetch from /borrower-insights",
    );
    assert.ok(
      !code.includes("fetch(`/api/deals/${dealId}/insights`)"),
      "Page must NOT fetch from /insights (old broken path)",
    );
  });

  it("page validates payload before setting data", () => {
    const code = readFileSync(pagePath, "utf-8");
    assert.ok(
      code.includes("healthSummary") && code.includes("whatMatters") && code.includes("incomplete"),
      "Page must validate canonical payload fields",
    );
  });
});

// ============================================================================
// Guard 3: Route uses shared formatters
// ============================================================================

describe("Guard 3: API route uses canonical formatters", () => {
  const routePath = join(ROOT, "src/app/api/deals/[dealId]/borrower-insights/route.ts");

  it("route imports from contracts.ts", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(
      code.includes("@/lib/borrowerReport/contracts"),
      "Route must import from contracts module",
    );
  });

  it("GET uses borrowerInsightRunRowToApiResponse", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("borrowerInsightRunRowToApiResponse"));
  });

  it("POST uses toBorrowerInsightsApiResponse", () => {
    const code = readFileSync(routePath, "utf-8");
    assert.ok(code.includes("toBorrowerInsightsApiResponse"));
  });

  it("route does NOT return mismatched aliases", () => {
    const code = readFileSync(routePath, "utf-8");
    // Should not return the old { insight, benchmarks, warnings } shape
    assert.ok(
      !code.includes("benchmarks:") && !code.includes("warnings:"),
      "Route must not return old mismatched field names",
    );
  });
});

// ============================================================================
// Guard 4: Persistence stores full canonical payload
// ============================================================================

describe("Guard 4: Persistence stores full payload", () => {
  const enginePath = join(ROOT, "src/lib/borrowerReport/insightsEngine.ts");

  it("insight_summary_json stores healthSummary", () => {
    const code = readFileSync(enginePath, "utf-8");
    assert.ok(
      code.includes("healthSummary: result.healthSummary"),
      "Must persist healthSummary in insight_summary_json",
    );
  });

  it("insight_summary_json stores whatMatters", () => {
    const code = readFileSync(enginePath, "utf-8");
    assert.ok(
      code.includes("whatMatters: result.whatMatters"),
      "Must persist whatMatters in insight_summary_json",
    );
  });

  it("insight_summary_json stores bankabilityActions", () => {
    const code = readFileSync(enginePath, "utf-8");
    assert.ok(
      code.includes("bankabilityActions: result.bankabilityActions"),
      "Must persist bankabilityActions in insight_summary_json",
    );
  });

  it("insight_summary_json does NOT store only counts", () => {
    const code = readFileSync(enginePath, "utf-8");
    assert.ok(
      !code.includes("strengths_count:") && !code.includes("concerns_count:") && !code.includes("actions_count:"),
      "Must not persist count-only summary",
    );
  });
});
