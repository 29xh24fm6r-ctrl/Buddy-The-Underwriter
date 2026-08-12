import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_VERSION,
  bearerMatches,
  parseProviderRequest,
  readProviderAdmission,
  sha256,
  validateSubmission,
} from "../contract";

const request = {
  contractVersion: CONTRACT_VERSION,
  jobId: "job-1",
  organizationId: "org-1",
  dealId: "deal-1",
  documentId: "doc-1",
  documentVersionId: "version-1",
  sha256: "a".repeat(64),
  mediaType: "application/pdf",
};

test("provider is default-off and requires a provider-only deployment", () => {
  assert.deepEqual(readProviderAdmission({}), { enabled: false, reason: "not_provider_deployment" });
  assert.deepEqual(readProviderAdmission({ BUDDY_LOS_PROVIDER_ONLY: "true" }), { enabled: false, reason: "disabled" });
});

test("provider activation requires a secret and an explicit organization entitlement", () => {
  const admission = readProviderAdmission({
    BUDDY_LOS_PROVIDER_ONLY: "true",
    BUDDY_LOS_PROVIDER_ENABLED: "true",
    BUDDY_LOS_PROVIDER_API_KEY: "x".repeat(32),
    BUDDY_LOS_PROVIDER_ORGANIZATION_IDS: "org-1, org-2",
  });
  assert.equal(admission.enabled, true);
  if (admission.enabled) assert.deepEqual([...admission.config.entitledOrganizationIds], ["org-1", "org-2"]);
});

test("submission is bound to authorization, entitlement, idempotency, media type and hash", () => {
  assert.equal(bearerMatches(`Bearer ${"x".repeat(32)}`, "x".repeat(32)), true);
  assert.equal(bearerMatches(`Bearer ${"y".repeat(32)}`, "x".repeat(32)), false);
  const parsed = parseProviderRequest(JSON.stringify(request));
  assert.doesNotThrow(() => validateSubmission({
    request: parsed,
    idempotencyKey: "job-1:version-1",
    fileMediaType: "application/pdf",
    fileSize: 100,
    entitledOrganizationIds: new Set(["org-1"]),
  }));
  assert.throws(() => validateSubmission({
    request: parsed,
    idempotencyKey: "wrong",
    fileMediaType: "application/pdf",
    fileSize: 100,
    entitledOrganizationIds: new Set(["org-1"]),
  }), /invalid_idempotency_key/);
  assert.equal(sha256(Buffer.from("buddy")), "e2284dc3b5535645288cde2bad818404be728fb8c9f70b055c0b52023b0ff0a0");
});
