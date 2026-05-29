import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = (relativePath: string) =>
  path.resolve(process.cwd(), relativePath);

// The builder/* verification harness (verify/underwrite, stitch/audit,
// token/status, deals mint/make-ready/decision/financial-snapshot/seed-intake,
// builder document uploads, and the _builder upload alias) was removed as
// dead/unreferenced routes in 824c90f7 and f4132ceb to stay under the Vercel
// route cap. This guard now pins the surviving meta + banker entry routes and
// the canonical underwriting pages that must remain registered.
test("meta + banker entry routes and underwriting pages are registered", () => {
  const buildRoute = routePath("src/app/api/_meta/build/route.ts");
  const bankerInitIntake = routePath("src/app/api/deals/[dealId]/intake/init/route.ts");
  const nextStepRoute = routePath("src/app/api/deals/[dealId]/next-step/route.ts");
  const commandPage = routePath("src/app/(app)/deals/[dealId]/command/page.tsx");
  const canonicalUnderwritePage = routePath("src/app/(app)/deals/[dealId]/underwrite/page.tsx");
  const underwritePage = routePath("src/app/(app)/underwrite/page.tsx");
  const underwriteDealPage = routePath("src/app/(app)/underwrite/[dealId]/page.tsx");
  const committeePage = routePath("src/app/(app)/deals/[dealId]/committee/page.tsx");

  assert.ok(fs.existsSync(buildRoute));
  assert.ok(fs.existsSync(bankerInitIntake));
  assert.ok(fs.existsSync(nextStepRoute));
  assert.ok(fs.existsSync(commandPage));
  assert.ok(fs.existsSync(canonicalUnderwritePage));
  assert.ok(fs.existsSync(underwritePage));
  assert.ok(fs.existsSync(underwriteDealPage));
  assert.ok(fs.existsSync(committeePage));
});

test("institutional underwriting routes are registered", () => {
  const synthRunRoute = routePath("src/app/api/deals/[dealId]/underwriting-synthesis/run/route.ts");
  const creditMemoGenRoute = routePath("src/app/api/deals/[dealId]/credit-memo/generate/route.ts");
  const readinessRoute = routePath("src/app/api/deals/[dealId]/readiness/route.ts");
  const documentsRoute = routePath("src/app/api/deals/[dealId]/documents/route.ts");
  const loanRequestRoute = routePath("src/app/api/deals/[dealId]/loan-request/route.ts");

  assert.ok(
    fs.existsSync(synthRunRoute),
    "underwriting-synthesis/run route must exist — this is the canonical synthesis entry point",
  );
  assert.ok(
    fs.existsSync(creditMemoGenRoute),
    "credit-memo/generate route must exist",
  );
  assert.ok(
    fs.existsSync(readinessRoute),
    "readiness route must exist",
  );
  assert.ok(
    fs.existsSync(documentsRoute),
    "documents route must exist",
  );
  assert.ok(
    fs.existsSync(loanRequestRoute),
    "loan-request route must exist",
  );
});
