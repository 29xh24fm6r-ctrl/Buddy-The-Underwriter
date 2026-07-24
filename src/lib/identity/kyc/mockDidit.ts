/**
 * Mock Didit client — test-mode only, gated by isMockVendorsEnabled() at
 * every call site. Matches the real DiditClient shape (src/lib/identity/
 * kyc/didit.ts) so it drops into initiateKyc()/handleDiditWebhook()
 * unchanged; only the actual HTTP calls are faked.
 *
 * No network calls, no real ID/liveness checks — this exists solely to let
 * a full Brokerage borrower walkthrough (seal → marketplace → pick → sign)
 * complete in an environment with no Didit credentials. It must never be
 * reachable when isMockVendorsEnabled() is false.
 *
 * Simpler than the old Persona mock it replaces: Didit's session-create
 * response already returns a usable `url` directly (no separate
 * one-time-link round trip), so createDiditSession can build the mock's
 * "open this to complete verification" URL right there — no closure
 * trick needed to thread dealId through, since it's already encoded in
 * `vendorData` (`deal:<dealId>:owner:<ownershipEntityId>`, per the real
 * initiateKyc() call site).
 */

import crypto from "node:crypto";

const VENDOR_DATA_PATTERN = /^deal:([^:]+):owner:([^:]+)$/;

export async function mockCreateDiditSession(args: {
  workflowId: string;
  vendorData: string;
  callbackUrl?: string;
}): Promise<{ session_id: string; status: string; workflow_id: string; url: string }> {
  const sessionId = `mock_sess_${crypto.randomBytes(8).toString("hex")}`;
  const match = VENDOR_DATA_PATTERN.exec(args.vendorData);
  const dealId = match?.[1] ?? "unknown-deal";

  return {
    session_id: sessionId,
    status: "Not Started",
    workflow_id: args.workflowId,
    url: `/api/brokerage/deals/${dealId}/borrower-actions/mock-complete-kyc?inquiryId=${encodeURIComponent(sessionId)}`,
  };
}

export async function mockFetchDiditSession(
  sessionId: string,
): Promise<{ session_id: string; status: string; workflow_id: string; url: string }> {
  return {
    session_id: sessionId,
    status: "Approved",
    workflow_id: "mock-workflow",
    url: `/api/brokerage/deals/unknown-deal/borrower-actions/mock-complete-kyc?inquiryId=${encodeURIComponent(sessionId)}`,
  };
}

export async function mockGetDiditSessionDecision(
  sessionId: string,
): Promise<{ session_id: string; status: string; [key: string]: unknown }> {
  return { session_id: sessionId, status: "Approved" };
}
