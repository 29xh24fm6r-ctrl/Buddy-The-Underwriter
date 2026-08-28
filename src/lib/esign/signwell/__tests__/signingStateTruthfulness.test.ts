import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const banker = readFileSync("src/app/api/deals/[dealId]/esign/route.ts", "utf8");
const portal = readFileSync("src/app/api/borrower/portal/[token]/esign/route.ts", "utf8");
const brokerage = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts",
  "utf8",
);

test("signing status routes never translate database failures into empty or missing state", () => {
  assert.match(banker, /signedDocError/);
  assert.match(banker, /signingRequestError/);
  assert.equal((banker.match(/signing_state_unavailable/g) ?? []).length >= 2, true);

  assert.match(portal, /docsError \|\| pendingError/);
  assert.match(portal, /!Array\.isArray\(docs\)/);
  assert.match(portal, /signing_state_unavailable/);

  assert.match(brokerage, /signedDocumentsError/);
  assert.match(brokerage, /pendingRequestsError/);
  assert.match(brokerage, /signedDocError/);
  assert.match(brokerage, /signingRequestError/);
  assert.equal((brokerage.match(/signing_state_unavailable/g) ?? []).length >= 3, true);
});
