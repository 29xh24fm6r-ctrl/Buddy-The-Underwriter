/**
 * NPI-eligibility gate per provider (SPEC-M1 AI-GATEWAY-1, program-level
 * vendor-gating decision approved 2026-07-29). Mirrors the `Status:` field
 * in docs/vendors/<provider>.md — kept in sync by
 * src/lib/ai/__tests__/vendorApprovalDocsSync.test.ts so the doc and this
 * gate can never drift apart.
 *
 * All three providers start PENDING, including Google/Gemini. Google is
 * already the pre-existing production vendor for the 18 direct call sites
 * this spec does NOT touch (see §0 inventory) — this gate has no effect on
 * those. But it's the first formal SR 11-7 vendor-doc review this repo has
 * done for any provider, so the *gateway's* new code path holds Google to
 * the same explicit sign-off as the two net-new vendors rather than
 * grandfathering it in silently. Matt flips a provider to APPROVED only
 * after reviewing its docs/vendors/<provider>.md.
 */

import type { GatewayProvider } from "./roleConfig";

export type VendorApprovalStatus = "PENDING" | "APPROVED";

export const VENDOR_NPI_APPROVAL: Record<GatewayProvider, VendorApprovalStatus> = {
  google: "PENDING",
  anthropic: "PENDING",
  openai: "PENDING",
};
