/**
 * NPI-eligibility gate per provider (SPEC-M1 AI-GATEWAY-1, program-level
 * vendor-gating decision approved 2026-07-29). Mirrors the `Status:` field
 * in docs/vendors/<provider>.md — kept in sync by
 * src/lib/ai/__tests__/vendorApprovalDocsSync.test.ts so the doc and this
 * gate can never drift apart.
 *
 * Matt approved Google/Gemini, OpenAI, and Anthropic/Claude for borrower-NPI
 * processing on 2026-08-17 after reviewing the provider controls documented
 * in docs/vendors/<provider>.md. The approval remains explicit in code so a
 * provider can be returned to PENDING immediately if its contract, retention,
 * training, residency, or security posture changes.
 */

import type { GatewayProvider } from "./roleConfig";

export type VendorApprovalStatus = "PENDING" | "APPROVED";

export const VENDOR_NPI_APPROVAL: Record<GatewayProvider, VendorApprovalStatus> = {
  google: "APPROVED",
  anthropic: "APPROVED",
  openai: "APPROVED",
};

/**
 * Test-only: temporarily flip a provider's approval status so a test can
 * exercise the "approved" path of an npiTagged call without touching real
 * vendor docs. Always pair with __resetVendorApprovalForTests() in an
 * afterEach — production code never calls this.
 */
export function __setVendorApprovalForTests(
  provider: GatewayProvider,
  status: VendorApprovalStatus,
): void {
  VENDOR_NPI_APPROVAL[provider] = status;
}

/** Test-only: restore all providers to their real default (PENDING). */
export function __resetVendorApprovalForTests(): void {
  VENDOR_NPI_APPROVAL.google = "APPROVED";
  VENDOR_NPI_APPROVAL.anthropic = "APPROVED";
  VENDOR_NPI_APPROVAL.openai = "APPROVED";
}
