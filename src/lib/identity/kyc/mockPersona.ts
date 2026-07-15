/**
 * Mock Persona client — test-mode only, gated by isMockVendorsEnabled()
 * at every call site that uses this. Matches the real PersonaClient shape
 * (src/lib/identity/kyc/persona.ts) so it drops into initiateKyc()/
 * handlePersonaWebhook() unchanged; only the actual HTTP calls are faked.
 *
 * No network calls, no real ID/liveness checks — this exists solely to let
 * a full Brokerage borrower walkthrough (seal → marketplace → pick → sign)
 * complete in an environment with no Persona credentials. It must never be
 * reachable when isMockVendorsEnabled() is false.
 */

import crypto from "node:crypto";

export async function mockCreatePersonaInquiry(_args: {
  templateId: string;
  referenceId: string;
  fields?: { nameFirst?: string; nameLast?: string };
}): Promise<{ data: { id: string } }> {
  return { data: { id: `mock_inq_${crypto.randomBytes(8).toString("hex")}` } };
}

export async function mockFetchPersonaInquiry(inquiryId: string): Promise<{
  data: { id: string; attributes: { status: string; "name-first"?: string | null; "name-last"?: string | null } };
}> {
  return {
    data: {
      id: inquiryId,
      attributes: { status: "completed", "name-first": "Test", "name-last": "Borrower" },
    },
  };
}

/**
 * Real Persona's one-time link opens a hosted, third-party verification
 * flow; the mock equivalent opens Buddy's own "mock-complete-kyc" action
 * (same [action] dispatcher, gated the same way) so a browser-driving test
 * can genuinely click through a confirmation page rather than the backend
 * silently pretending the borrower verified.
 */
export function buildMockPersonaOneTimeLink(dealId: string, inquiryId: string): string {
  return `/api/brokerage/deals/${dealId}/borrower-actions/mock-complete-kyc?inquiryId=${encodeURIComponent(inquiryId)}`;
}
