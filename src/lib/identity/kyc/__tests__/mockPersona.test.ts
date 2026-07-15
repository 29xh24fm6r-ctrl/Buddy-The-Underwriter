import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mockCreatePersonaInquiry,
  mockFetchPersonaInquiry,
  buildMockPersonaOneTimeLink,
} from "@/lib/identity/kyc/mockPersona";

test("mockCreatePersonaInquiry: returns a distinctly-prefixed fake inquiry id", async () => {
  const result = await mockCreatePersonaInquiry({ templateId: "t1", referenceId: "ref1" });
  assert.match(result.data.id, /^mock_inq_/);
});

test("mockCreatePersonaInquiry: two calls produce different ids", async () => {
  const a = await mockCreatePersonaInquiry({ templateId: "t1", referenceId: "ref1" });
  const b = await mockCreatePersonaInquiry({ templateId: "t1", referenceId: "ref2" });
  assert.notEqual(a.data.id, b.data.id);
});

test("mockFetchPersonaInquiry: always reports completed status", async () => {
  const result = await mockFetchPersonaInquiry("mock_inq_abc123");
  assert.equal(result.data.id, "mock_inq_abc123");
  assert.equal(result.data.attributes.status, "completed");
});

test("buildMockPersonaOneTimeLink: points at the borrower-actions mock-complete-kyc action for the given deal", () => {
  const link = buildMockPersonaOneTimeLink("deal-42", "mock_inq_abc123");
  assert.equal(link, "/api/brokerage/deals/deal-42/borrower-actions/mock-complete-kyc?inquiryId=mock_inq_abc123");
});
