import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const portal = readFileSync("src/app/api/borrower/portal/[token]/identity/route.ts", "utf8");
const brokerage = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts",
  "utf8",
);
const service = readFileSync("src/lib/identity/kyc/service.ts", "utf8");

test("identity state surfaces distinguish database failure from empty or missing state", () => {
  assert.match(portal, /ownersError \|\| !Array\.isArray\(owners\)/);
  assert.match(portal, /verificationsError \|\| !Array\.isArray\(verifications\)/);
  assert.equal((portal.match(/identity_state_unavailable|IDENTITY_STATE_UNAVAILABLE/g) ?? []).length >= 4, true);

  assert.match(brokerage, /ownersError \|\|/);
  assert.match(brokerage, /verificationsError \|\|/);
  assert.equal((brokerage.match(/identity_state_unavailable/g) ?? []).length >= 4, true);

  assert.match(service, /reason: "OWNER_NOT_FOUND" \| "STATE_READ_FAILED"/);
  assert.match(service, /existing_verification_lookup_failed/);
  assert.match(service, /owner_lookup_failed/);
  assert.match(service, /readError: rowsError\?\.message/);
});
