/**
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1-HOTFIX — structural tripwire for
 * the concierge route's email-auto-claim dedup guard. Same source-grep
 * convention as assumptionInterviewConfirmWiring.test.ts (no mocking
 * precedent for this route's full request/response cycle — it's a large,
 * heavily-branched handler; a full integration test would need extensive
 * new scaffolding out of proportion to this fix).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/brokerage/concierge/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: listBorrowerApplications is imported and called before claimBorrowerSession in the auto-claim path", () => {
  const src = readSrc();
  assert.match(src, /import \{ listBorrowerApplications \} from "@\/lib\/brokerage\/listBorrowerApplications";/);

  const claimIdx = src.indexOf("// Claim the session the first time an email appears.");
  assert.ok(claimIdx > -1, "auto-claim block must exist");
  const claimBlock = src.slice(claimIdx, claimIdx + 2500);

  const lookupIdx = claimBlock.indexOf("await listBorrowerApplications(");
  const claimCallIdx = claimBlock.indexOf("await claimBorrowerSession(");
  assert.ok(lookupIdx > -1, "must check for existing applications");
  assert.ok(claimCallIdx > -1, "must still claim in the no-existing-applications case");
  assert.ok(lookupIdx < claimCallIdx, "existing-application lookup must happen BEFORE claiming — this is the fix");
});

test("TRIPWIRE: a lookup failure fails closed (does not claim) rather than risking another duplicate", () => {
  const src = readSrc();
  const claimIdx = src.indexOf("// Claim the session the first time an email appears.");
  const claimBlock = src.slice(claimIdx, claimIdx + 2500);
  assert.match(claimBlock, /catch \(lookupErr\)/);
  assert.match(claimBlock, /hasExistingApplications = true;/);
});

test("TRIPWIRE: claimBorrowerSession is gated on !hasExistingApplications", () => {
  const src = readSrc();
  const claimIdx = src.indexOf("// Claim the session the first time an email appears.");
  const claimBlock = src.slice(claimIdx, claimIdx + 2500);
  assert.match(claimBlock, /if \(!hasExistingApplications\) \{/);
});

test("TRIPWIRE: Plaid link-token creation no longer requests the unauthorized Auth product", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/integrations/plaid/linkToken.ts"),
    "utf8",
  );
  assert.match(src, /products:\s*\[Products\.Transactions,\s*Products\.Identity\]/, "products array must be exactly [Transactions, Identity] — Auth is not in Buddy's authorized Plaid product scope");
});

test("TRIPWIRE: Plaid link-token route never leaks a raw error message to the borrower — always maps to a friendly errorCode", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/app/api/borrower/plaid/[action]/route.ts"),
    "utf8",
  );
  const linkTokenIdx = src.indexOf('if (action === "link-token")');
  assert.ok(linkTokenIdx > -1);
  const block = src.slice(linkTokenIdx, linkTokenIdx + 2500);
  assert.match(block, /catch \(linkTokenErr/);
  assert.match(block, /errorCode: "plaid_unavailable"/);
  assert.match(block, /temporarily unavailable/);
});

test("TRIPWIRE: PlaidConnectCard treats plaid_unavailable the same as plaid_not_configured (both render the non-blocking 'unavailable' state)", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/components/borrower/PlaidConnectCard.tsx"),
    "utf8",
  );
  assert.match(src, /tokenBody\?\.errorCode === "plaid_not_configured" \|\|\s*\n\s*tokenBody\?\.errorCode === "plaid_unavailable"/);
});
