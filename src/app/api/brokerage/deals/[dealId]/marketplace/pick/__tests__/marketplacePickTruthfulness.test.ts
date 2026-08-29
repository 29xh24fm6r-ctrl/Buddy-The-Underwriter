import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(
  path.resolve(
    __dirname,
    "../route.ts",
  ),
  "utf8",
);

test("borrower pick can resume an interrupted picked listing", () => {
  assert.match(
    route,
    /\.in\("status", \["awaiting_borrower_pick", "claiming", "picked"\]\)/,
  );
  assert.match(route, /existingPick/);
  assert.match(route, /different_claim_already_picked/);
});

test("sealed artifacts are complete and proven before the pick insert", () => {
  const artifactGate = route.indexOf("sealed_package_artifacts_incomplete");
  const pickInsert = route.indexOf('.from("marketplace_picks")', artifactGate);
  assert.ok(artifactGate >= 0, "missing sealed artifact completeness gate");
  assert.ok(pickInsert > artifactGate, "pick must occur after immutable artifacts are proven");
  assert.match(route, /sealed_package_binding_unproven/);
});

test("listing, losing claims, package access, and audit writes require returned-row proof", () => {
  for (const invariant of [
    "listing_pick_failed",
    "losing_claims_withdrawal_failed",
    "package_access_grant_failed",
    "package_access_grant_unproven",
    "pick_audit_persistence_failed",
  ]) {
    assert.ok(route.includes(invariant), `missing ${invariant} fail-closed outcome`);
  }
  assert.match(route, /\.select\("id, status"\)/);
  assert.match(route, /\.select\(\s*"id, listing_id, claim_id, deal_id, lender_bank_id, sealed_package_id, access_level, revoked_at",\s*\)/);
});

test("success never returns a nullable lender access id", () => {
  assert.doesNotMatch(route, /accessId:\s*\(access as any\)\?\.id\s*\?\?\s*null/);
  assert.match(route, /accessId:\s*String\(access\.id\)/);
});

test("lender selection and package-access notifications are required evidence", () => {
  assert.match(route, /lender_selection_notification_failed/);
  assert.match(route, /package_access_notification_failed/);
  assert.doesNotMatch(route, /lender comms failed \(non-fatal\)/);
});

test("route no longer swallows marketplace persistence failures", () => {
  assert.doesNotMatch(route, /\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(route, /artifact binding failed \(non-fatal\)/);
});
