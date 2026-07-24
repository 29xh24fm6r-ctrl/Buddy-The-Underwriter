import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mockCreateDiditSession,
  mockFetchDiditSession,
  mockGetDiditSessionDecision,
} from "@/lib/identity/kyc/mockDidit";

test("mockCreateDiditSession: returns a distinctly-prefixed fake session id and a usable url", async () => {
  const result = await mockCreateDiditSession({ workflowId: "wf1", vendorData: "deal:deal-42:owner:owner-1" });
  assert.match(result.session_id, /^mock_sess_/);
  assert.equal(result.status, "Not Started");
  assert.equal(result.workflow_id, "wf1");
  assert.equal(result.url, `/api/brokerage/deals/deal-42/borrower-actions/mock-complete-kyc?inquiryId=${result.session_id}`);
});

test("mockCreateDiditSession: two calls produce different session ids", async () => {
  const a = await mockCreateDiditSession({ workflowId: "wf1", vendorData: "deal:deal-1:owner:owner-1" });
  const b = await mockCreateDiditSession({ workflowId: "wf1", vendorData: "deal:deal-1:owner:owner-2" });
  assert.notEqual(a.session_id, b.session_id);
});

test("mockFetchDiditSession: always reports Approved status", async () => {
  const result = await mockFetchDiditSession("mock_sess_abc123");
  assert.equal(result.session_id, "mock_sess_abc123");
  assert.equal(result.status, "Approved");
});

test("mockGetDiditSessionDecision: reports Approved status", async () => {
  const result = await mockGetDiditSessionDecision("mock_sess_abc123");
  assert.equal(result.status, "Approved");
});
