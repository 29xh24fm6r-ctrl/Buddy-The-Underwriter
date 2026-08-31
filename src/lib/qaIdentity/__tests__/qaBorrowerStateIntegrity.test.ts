import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

test("QA borrower classification reads fail closed", () => {
  const auth = read("src/lib/qaIdentity/qaAuth.ts");

  assert.match(auth, /existingLeadError/);
  assert.match(auth, /leadDealError \|\| !leadDeal/);
  assert.match(auth, /existingTestDealError/);
  assert.match(auth, /nonTestDealError/);
  assert.match(auth, /resolvedDealError \|\| !resolvedDeal/);
  assert.match(auth, /error \|\| !data/);
  assert.match(auth, /qa_state_unavailable/g);
});

test("QA marker cannot reclassify a non-test or unproven deal", () => {
  const marker = read("src/lib/qaIdentity/markTestApplication.ts");

  assert.match(marker, /if \(readError\) throw new Error\("qa_state_unavailable"\)/);
  assert.match(marker, /deal\.is_test !== true/);
  assert.match(marker, /\.eq\("is_test", true\)/);
  assert.match(marker, /\.select\("id, test_run_id, test_created_at"\)/);
  assert.doesNotMatch(marker, /is_test:\s*true/);
  assert.doesNotMatch(marker, /error\.message|result\?\.error/);
});

test("QA borrower routes bind tenant, bound input, and hide internal failures", () => {
  const applications = read(
    "src/app/api/qa/borrower/applications/route.ts",
  );
  const authRoute = read("src/app/api/qa/borrower/auth/route.ts");

  assert.match(applications, /MAX_BODY_BYTES = 8_192/);
  assert.match(applications, /bankId: ctx\.bankId/);
  assert.match(applications, /\.eq\("bank_id", ctx\.bankId\)/);
  assert.match(applications, /applications_unavailable/);
  assert.match(applications, /resume_state_unavailable/);
  assert.doesNotMatch(applications, /e instanceof Error|e\?\.message/);

  assert.match(authRoute, /MAX_BODY_BYTES = 8_192/);
  assert.match(authRoute, /verification_unavailable/);
  assert.match(authRoute, /brokerage_tenant_missing/);
  assert.doesNotMatch(authRoute, /e instanceof Error|error: msg/);
});
