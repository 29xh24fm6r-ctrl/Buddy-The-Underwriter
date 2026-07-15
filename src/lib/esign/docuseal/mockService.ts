/**
 * Mock e-signature initiation — test-mode only, gated by
 * isMockVendorsEnabled() at every call site.
 *
 * NOT a thin wrapper around the real requestSignature() (src/lib/esign/
 * docuseal/service.ts): that function calls resolveTemplateId()/
 * buildEmbedUrl() internally, which read DOCUSEAL_TEMPLATE_<FORM_CODE> and
 * DOCUSEAL_BASE_URL_PUBLIC directly from process.env — not injected
 * dependencies, so they can't be swapped for a mock and would throw
 * "docuseal_template_not_configured" even with a fake docuseal client.
 * This reimplements just the initiation step (IAL2 gate + submission
 * bookkeeping); completion is still handled by the REAL
 * handleDocusealWebhook() with a mock docuseal client injected — see
 * mockClient.ts — so the IAL2-gates-signing invariant (principle #17) is
 * genuinely exercised at both request and completion time, same as
 * production.
 */

import crypto from "node:crypto";
import type { KycSupabaseClient } from "@/lib/identity/kyc/service";
import { hasValidIal2 } from "@/lib/identity/kyc/service";
import type { RequestSignatureArgs, RequestSignatureResult } from "@/lib/esign/docuseal/service";

export async function mockRequestSignature(
  args: RequestSignatureArgs,
  deps: { sb: KycSupabaseClient },
): Promise<RequestSignatureResult> {
  // IAL2 GATE — no exceptions, same invariant as the real requestSignature.
  const ial2Valid = await hasValidIal2(args.dealId, args.signerOwnershipEntityId, deps.sb);
  if (!ial2Valid) {
    return { ok: false, reason: "IAL2_NOT_COMPLETED" };
  }

  const submissionId = `mock_${crypto.randomBytes(8).toString("hex")}`;
  const externalId = `deal:${args.dealId}:form:${args.formCode}:signer:${args.signerOwnershipEntityId}`;
  const embedUrl =
    `/api/brokerage/deals/${args.dealId}/borrower-actions/mock-complete-esign` +
    `?submissionId=${encodeURIComponent(submissionId)}&externalId=${encodeURIComponent(externalId)}`;

  return { ok: true, submissionId, embedUrl };
}
