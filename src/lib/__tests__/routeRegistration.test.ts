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
  const nextStepRoute = routePath("src/app/api/deals/[dealId]/next-step/route.ts");
  const commandPage = routePath("src/app/(app)/deals/[dealId]/command/page.tsx");
  const underwritePage = routePath("src/app/(app)/underwrite/page.tsx");
  const underwriteDealPage = routePath("src/app/(app)/underwrite/[dealId]/page.tsx");
  const committeePage = routePath("src/app/(app)/deals/[dealId]/committee/page.tsx");

  assert.ok(fs.existsSync(buildRoute));
  assert.ok(fs.existsSync(verifyRoute));
  assert.ok(fs.existsSync(stitchAuditRoute));
  assert.ok(fs.existsSync(nextStepRoute));
  assert.ok(fs.existsSync(commandPage));
  assert.ok(fs.existsSync(underwritePage));
  assert.ok(fs.existsSync(underwriteDealPage));
  assert.ok(fs.existsSync(committeePage));
});
