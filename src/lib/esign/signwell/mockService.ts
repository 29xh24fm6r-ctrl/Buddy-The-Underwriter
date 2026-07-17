/**
 * Mock e-signature initiation — test-mode only, gated by
 * isMockVendorsEnabled() at every call site.
 *
 * NOT a thin wrapper around the real requestSignature() (src/lib/esign/
 * signwell/service.ts): that function renders the real filled SBA PDF via
 * an injected renderFilledPdf dependency, which mock callers have no
 * reason to satisfy (there's no filled PDF to render in a test-mode
 * walkthrough). This reimplements just the initiation step (IAL2 gate +
 * bookkeeping); completion is still handled by the REAL
 * handleSignwellWebhook() with a mock signwell client injected — see
 * mockClient.ts — so the IAL2-gates-signing invariant (principle #17) is
 * genuinely exercised at both request and completion time, same as
 * production.
 */

import crypto from "node:crypto";
import type { KycSupabaseClient } from "@/lib/identity/kyc/service";
import { hasValidIal2 } from "@/lib/identity/kyc/service";
import type { RequestSignatureArgs, RequestSignatureResult } from "@/lib/esign/signwell/service";

export async function mockRequestSignature(
  args: RequestSignatureArgs,
  deps: { sb: KycSupabaseClient },
): Promise<RequestSignatureResult> {
  // IAL2 GATE — no exceptions, same invariant as the real requestSignature.
  const ial2Valid = await hasValidIal2(args.dealId, args.signerOwnershipEntityId, deps.sb);
  if (!ial2Valid) {
    return { ok: false, reason: "IAL2_NOT_COMPLETED" };
  }

  const documentId = `mock_${crypto.randomBytes(8).toString("hex")}`;
  const externalId = `deal:${args.dealId}:form:${args.formCode}:signer:${args.signerOwnershipEntityId}`;
  const embedUrl =
    `/api/brokerage/deals/${args.dealId}/borrower-actions/mock-complete-esign` +
    `?submissionId=${encodeURIComponent(documentId)}&externalId=${encodeURIComponent(externalId)}`;

  return { ok: true, documentId, embedUrl };
}
