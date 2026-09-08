import assert from "node:assert/strict";
import test from "node:test";
import { hasValidBrokerageCertificationClaims } from "../githubActionsOidcClaims";

const valid = {
  repository: "29xh24fm6r-ctrl/Buddy-The-Underwriter",
  repository_id: "1117619648",
  repository_owner_id: "243685602",
  ref: "refs/heads/main",
  event_name: "workflow_dispatch",
  environment: "Production",
  workflow_ref: "29xh24fm6r-ctrl/Buddy-The-Underwriter/.github/workflows/brokerage-production-certification.yml@refs/heads/main",
  sub: "repo:29xh24fm6r-ctrl/Buddy-The-Underwriter:environment:Production",
};

test("accepts only the production certification workflow on main", () => {
  assert.equal(hasValidBrokerageCertificationClaims(valid), true);
});

for (const field of ["repository", "repository_id", "repository_owner_id", "ref", "event_name", "environment", "workflow_ref", "sub"] as const) {
  test(`rejects a mismatched ${field} claim`, () => {
    assert.equal(
      hasValidBrokerageCertificationClaims({ ...valid, [field]: "wrong" }),
      false,
    );
  });
}
