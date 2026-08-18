import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const PROJECTION_CONSUMERS = [
  "src/lib/sba/sbaPackageOrchestrator.ts",
  "src/app/api/borrower/portal/[token]/generate-pdf/route.ts",
  "src/components/borrower/intake/AssumptionInterview.tsx",
  "src/components/borrower/intake/ProjectionDashboard.tsx",
] as const;

const FORBIDDEN_DIRECT_CALCULATORS = [
  "buildAnnualProjections",
  "buildMonthlyProjections",
  "buildRevenueStreamProjections",
  "computeBreakEven",
  "buildSensitivityScenarios",
] as const;

test("borrower-facing projection consumers use the versioned authority", () => {
  for (const relativePath of PROJECTION_CONSUMERS) {
    const source = readFileSync(resolve(ROOT, relativePath), "utf8");
    assert.match(
      source,
      /computeSBAProjectionModel/,
      `${relativePath} must consume the authoritative SBA projection model`,
    );
    for (const calculator of FORBIDDEN_DIRECT_CALCULATORS) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b${calculator}\\b`),
        `${relativePath} must not invoke ${calculator} directly`,
      );
    }
  }
});

test("Golden Trident narrative receives the same versioned projection facts", () => {
  const source = readFileSync(
    resolve(ROOT, "src/lib/sba/sbaPackageOrchestrator.ts"),
    "utf8",
  );
  assert.match(source, /engineVersion:\s*projectionModel\.engineVersion/);
  assert.match(source, /projectedEbitda:\s*year1Projection\?\.ebitda/);
  assert.match(
    source,
    /proposedAnnualDebtService:\s*year1Projection\?\.totalDebtService/,
  );
  assert.match(source, /projectedDscr:\s*year1Projection\?\.dscr/);
});

test("projection narrative does not recompute when authoritative facts are supplied", () => {
  const source = readFileSync(
    resolve(ROOT, "src/lib/methodology/projectionsAssumptionsNarrative.ts"),
    "utf8",
  );
  const authorityBranch = source.slice(
    source.indexOf("if (authoritativeFacts)"),
    source.indexOf("} else {", source.indexOf("if (authoritativeFacts)")),
  );
  assert.match(authorityBranch, /facts = \{ \.\.\.authoritativeFacts \}/);
  assert.doesNotMatch(authorityBranch, /projectDscrForVariant/);
  assert.doesNotMatch(authorityBranch, /loadProjectionInputsForDeal/);
});
