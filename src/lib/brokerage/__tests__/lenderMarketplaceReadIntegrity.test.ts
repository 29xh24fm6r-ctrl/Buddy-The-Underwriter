import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { selectLenderIdentity } from "../lenderIdentityBoundary";

const root = path.resolve(__dirname, "../../..");
const authSource = fs.readFileSync(path.join(root, "lib/brokerage/lenderAuth.ts"), "utf8");
const listingsSource = fs.readFileSync(
  path.join(root, "app/api/lender/marketplace/listings/route.ts"),
  "utf8",
);
const dealSource = fs.readFileSync(
  path.join(root, "app/api/lender/deals/[dealId]/route.ts"),
  "utf8",
);

test("identity selection rejects ambiguity and malformed evidence", () => {
  assert.deepEqual(
    selectLenderIdentity("user-1", [{ bank_id: "bank-1" }], [
      { lender_bank_id: "bank-1" },
    ]),
    { ok: true, identity: { userId: "user-1", lenderBankId: "bank-1" } },
  );
  assert.deepEqual(
    selectLenderIdentity(
      "user-1",
      [{ bank_id: "bank-1" }, { bank_id: "bank-2" }],
      [{ lender_bank_id: "bank-1" }, { lender_bank_id: "bank-2" }],
    ),
    { ok: false, reason: "ambiguous_lender_identity" },
  );
  assert.deepEqual(
    selectLenderIdentity("user-1", [{ bank_id: "bank-1" }], [
      { lender_bank_id: "bank-x" },
    ]),
    { ok: false, reason: "invalid_lender_identity" },
  );
});

test("lender identity database failures remain non-green", () => {
  assert.match(authSource, /membershipError/);
  assert.match(authSource, /agreementError/);
  assert.match(authSource, /identity_state_unavailable/);
  assert.match(authSource, /\.limit\(2\)/);
});

test("listing feed carries deal identity only for server-side isolation", () => {
  assert.match(listingsSource, /id, deal_id, kfs/);
  assert.match(listingsSource, /marketplace_isolation_unavailable/);
  assert.match(listingsSource, /deal_id: _dealId/);
  assert.doesNotMatch(listingsSource, /\.filter\(\(l: any\) => !testDealIdSet\.has\(l\.deal_id\)\)/);
});

test("listing and claim reads fail closed and all responses are no-store", () => {
  assert.match(listingsSource, /marketplace_listings_unavailable/);
  assert.match(listingsSource, /marketplace_claim_state_unavailable/);
  assert.match(listingsSource, /no-store, max-age=0/);
  assert.doesNotMatch(listingsSource, /error\.message/);
});

test("lender deal detail requires grant and every supporting read", () => {
  for (const outcome of [
    "package_access_unavailable",
    "deal_isolation_state_unavailable",
    "deal_state_unavailable",
    "checklist_state_unavailable",
    "document_state_unavailable",
    "timeline_state_unavailable",
  ]) {
    assert.ok(dealSource.includes(outcome), `missing ${outcome}`);
  }
  assert.match(dealSource, /Promise\.all/);
  assert.match(dealSource, /no-store, max-age=0/);
  assert.doesNotMatch(dealSource, /error:\s*err\.message/);
  assert.doesNotMatch(dealSource, /console\.error[^;]*dealId/s);
});
