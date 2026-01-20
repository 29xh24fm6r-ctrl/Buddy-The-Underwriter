import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = (relativePath: string) =>
  path.resolve(process.cwd(), relativePath);

test("builder verify and meta routes are registered", () => {
  const buildRoute = routePath("src/app/api/_meta/build/route.ts");
  const verifyRoute = routePath("src/app/api/builder/verify/underwrite/route.ts");
  const stitchAuditRoute = routePath("src/app/api/builder/stitch/audit/route.ts");
  const builderTokenStatus = routePath("src/app/api/builder/token/status/route.ts");
  const builderMint = routePath("src/app/api/builder/deals/mint/route.ts");
  const builderMakeReady = routePath("src/app/api/builder/deals/make-ready/route.ts");
  const builderDecisionLatest = routePath("src/app/api/builder/deals/[dealId]/decision/latest/route.ts");
  const builderFinancialDecision = routePath("src/app/api/builder/deals/[dealId]/financial-snapshot/decision/route.ts");
  const nextStepRoute = routePath("src/app/api/deals/[dealId]/next-step/route.ts");
  const commandPage = routePath("src/app/(app)/deals/[dealId]/command/page.tsx");
  const canonicalUnderwritePage = routePath("src/app/(app)/deals/[dealId]/underwrite/page.tsx");
  const underwritePage = routePath("src/app/(app)/underwrite/page.tsx");
  const underwriteDealPage = routePath("src/app/(app)/underwrite/[dealId]/page.tsx");
  const committeePage = routePath("src/app/(app)/deals/[dealId]/committee/page.tsx");

  assert.ok(fs.existsSync(buildRoute));
  assert.ok(fs.existsSync(verifyRoute));
  assert.ok(fs.existsSync(stitchAuditRoute));
  assert.ok(fs.existsSync(builderTokenStatus));
  assert.ok(fs.existsSync(builderMint));
  assert.ok(fs.existsSync(builderMakeReady));
  assert.ok(fs.existsSync(builderDecisionLatest));
  assert.ok(fs.existsSync(builderFinancialDecision));
  assert.ok(fs.existsSync(nextStepRoute));
  assert.ok(fs.existsSync(commandPage));
  assert.ok(fs.existsSync(canonicalUnderwritePage));
  assert.ok(fs.existsSync(underwritePage));
  assert.ok(fs.existsSync(underwriteDealPage));
  assert.ok(fs.existsSync(committeePage));
});
