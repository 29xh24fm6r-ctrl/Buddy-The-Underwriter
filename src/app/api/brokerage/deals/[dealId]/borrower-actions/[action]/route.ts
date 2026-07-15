import "server-only";

/**
 * Ticket 2 (SPEC-BROKERAGE-SBA-READY-V1) — Brokerage-borrower identity
 * verification (Persona IAL2) + e-signature (DocuSeal), consolidated into
 * one [action] dispatcher (action = "kyc" | "esign") — route/page slot
 * budget discipline (routeConsolidationGuard.test.ts), same pattern as
 * /api/deals/[dealId]/model-v2/[action] and .../research/[action]. Cookie-
 * authed via getBorrowerSession, mirroring seal/route.ts and
 * marketplace/pick/route.ts (session.deal_id must match [dealId] or 404).
 *
 * The underlying initiateKyc()/requestSignature() functions
 * (src/lib/identity/kyc/service.ts, src/lib/esign/docuseal/service.ts) are
 * tenant-agnostic — this route is a new auth wrapper around them, not a
 * fork. The Underwriter-tenant routes (/api/deals/[dealId]/kyc,
 * .../esign) are unchanged and still gate on Clerk + bank-membership;
 * deliberately kept as separate files from this one rather than merged
 * with it, since branching banker vs. borrower auth inside one handler is
 * exactly the cross-tenant risk this codebase has been burned by before
 * (see routeConsolidationGuard.test.ts's existing-debt comment).
 *
 * kyc:
 *   GET  (no query)                -> owners at/above the 20% ownership
 *                                      threshold + their IAL2 status.
 *   GET  ?ownershipEntityId=...    -> latest verification record for one owner.
 *   POST { ownership_entity_id }   -> initiate a Persona IAL2 verification.
 *
 * esign (form_code is generic, not tied to the forms-* actions below —
 * DocuSeal signing uses its own pre-configured template per form code, not
 * the PDF forms-* generates; see the T5 AAR):
 *   GET  ?submissionId=...         -> submission status.
 *   POST { form_code, template_version, signer_ownership_entity_id,
 *          signer_role, signer_email, signer_name } -> request a signature.
 *
 * forms (per-owner SBA form generation — surfaced as a Ticket 2 follow-up;
 * produces the filled reference PDFs for the eventual lender-facing 10-tab
 * package. Reuses the exact Underwriter-tenant pipeline — prepareSbaPackage/
 * generatePdfForFillRun/assembleTenTabPackage, src/lib/brokerage/
 * borrowerFormsOrchestration.ts — resolving "the deal's package run"
 * server-side instead of trusting a client-supplied packageRunId):
 *   GET  forms-status              -> the deal's package run + item statuses.
 *   POST prepare-forms             -> create (or reuse) the package run.
 *   POST generate-forms { onlyItemId? } -> render one or all ungenerated items.
 *   POST assemble-forms            -> merge all generated items into one PDF.
 *
 * mock-complete-kyc / mock-complete-esign — test-mode-only completion
 * endpoints for the mock-vendor harness (isMockVendorsEnabled(), gated
 * behind BUDDY_MOCK_VENDORS + NODE_ENV!=="production"). kyc/esign above
 * already transparently swap in mock Persona/DocuSeal clients when that
 * flag is on; these two GET actions are what the resulting mock
 * one-time-link/embed_url actually open, so a browser-driving E2E test can
 * click through a real confirmation page instead of the flow silently
 * completing itself. 404s unconditionally when the flag is off — these
 * must never be reachable outside test mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { initiateKyc, handlePersonaWebhook } from "@/lib/identity/kyc/service";
import {
  createPersonaInquiry,
  fetchPersonaInquiry,
  generatePersonaOneTimeLink,
} from "@/lib/identity/kyc/persona";
import { requiresPersonalPackage } from "@/lib/ownership/rules";
import { requestSignature } from "@/lib/esign/docuseal/service";
import { handleDocusealWebhook } from "@/lib/esign/docuseal/service";
import {
  createDocusealSubmission,
  fetchDocusealSubmission,
  downloadDocusealSignedPdf,
  downloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/client";
import {
  prepareBrokerageSbaForms,
  getBrokerageFormsStatus,
  generateBrokerageForms,
  assembleBrokerageFormsPackage,
} from "@/lib/brokerage/borrowerFormsOrchestration";
import { isMockVendorsEnabled } from "@/lib/testMode/mockVendors";
import {
  mockCreatePersonaInquiry,
  mockFetchPersonaInquiry,
  buildMockPersonaOneTimeLink,
} from "@/lib/identity/kyc/mockPersona";
import { mockRequestSignature } from "@/lib/esign/docuseal/mockService";
import {
  mockCreateDocusealSubmission,
  mockFetchDocusealSubmission,
  mockDownloadDocusealSignedPdf,
  mockDownloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/mockClient";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; action: string }> };

const SIGNER_ROLES = new Set(["applicant", "guarantor", "spouse", "agent", "witness"]);

export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { dealId, action } = await params;
  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (action === "kyc") return getKycStatus(req, dealId, session.claimed_email);
  if (action === "esign") return getEsignStatus(req, dealId);
  if (action === "forms-status") return getFormsStatus(dealId);
  if (action === "mock-complete-kyc") return getMockCompleteKyc(req, dealId);
  if (action === "mock-complete-esign") return getMockCompleteEsign(req, dealId);
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { dealId, action } = await params;
  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (action === "kyc") return postKyc(req, dealId, session.bank_id);
  if (action === "esign") return postEsign(req, dealId, session.bank_id);
  if (action === "prepare-forms") return postPrepareForms(dealId);
  if (action === "generate-forms") return postGenerateForms(req, dealId);
  if (action === "assemble-forms") return postAssembleForms(dealId);
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 404 });
}

async function getKycStatus(req: NextRequest, dealId: string, sessionEmail: string | null): Promise<NextResponse> {
  const sb = supabaseAdmin();
  const ownershipEntityId = req.nextUrl.searchParams.get("ownershipEntityId");

  if (ownershipEntityId) {
    // A single owner's status must belong to this deal — a borrower must
    // never be able to probe another deal's verification record by guessing
    // an ownershipEntityId (fails closed, same invariant as seal/pick).
    const { data: owner } = await sb
      .from("ownership_entities")
      .select("id")
      .eq("id", ownershipEntityId)
      .eq("deal_id", dealId)
      .maybeSingle();
    if (!owner) {
      return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
    }

    const { data } = await sb
      .from("borrower_identity_verifications")
      .select("*")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", ownershipEntityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ ok: true, verification: data ?? null });
  }

  const { data: owners } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct")
    .eq("deal_id", dealId);

  const { data: verifications } = await sb
    .from("borrower_identity_verifications")
    .select("ownership_entity_id, status, completed_at, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  const owingOwners = ((owners ?? []) as Array<Record<string, any>>).filter((o) =>
    requiresPersonalPackage(o.ownership_pct),
  );

  const rows = owingOwners.map((owner) => {
    const latest = (verifications ?? []).find((v: any) => v.ownership_entity_id === owner.id) ?? null;
    const ial2Status: "verified" | "pending" | "declined" | "not_started" = !latest
      ? "not_started"
      : ["completed", "approved"].includes(latest.status)
        ? "verified"
        : ["declined", "failed", "expired"].includes(latest.status)
          ? "declined"
          : "pending";

    return {
      ownershipEntityId: owner.id,
      displayName: owner.display_name,
      ownershipPct: owner.ownership_pct,
      ial2Status,
    };
  });

  return NextResponse.json({ ok: true, owners: rows, sessionEmail });
}

async function postKyc(req: NextRequest, dealId: string, bankId: string): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const ownershipEntityId = body?.ownership_entity_id;
  if (typeof ownershipEntityId !== "string" || !ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: owner } = await sb
    .from("ownership_entities")
    .select("id")
    .eq("id", ownershipEntityId)
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!owner) {
    return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
  }

  const mockMode = isMockVendorsEnabled();
  const templateId = mockMode ? "mock-template-ial2" : process.env.PERSONA_TEMPLATE_ID_IAL2;
  if (!templateId) {
    return NextResponse.json({ ok: false, error: "persona_not_configured" }, { status: 503 });
  }

  const result = await initiateKyc(
    {
      dealId,
      bankId,
      ownershipEntityId,
      initiatorUserId: `brokerage_borrower_session:${dealId}`,
      initiatorIp: req.headers.get("x-forwarded-for"),
      initiatorUserAgent: req.headers.get("user-agent"),
      ...(mockMode ? { vendorOverride: "mock_persona" } : {}),
    },
    {
      sb: supabaseAdmin(),
      persona: mockMode
        ? {
            createPersonaInquiry: mockCreatePersonaInquiry,
            fetchPersonaInquiry: mockFetchPersonaInquiry,
            generatePersonaOneTimeLink: (inquiryId: string) =>
              Promise.resolve(buildMockPersonaOneTimeLink(dealId, inquiryId)),
          }
        : { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink },
      templateId,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: result.reason === "OWNER_NOT_FOUND" ? 404 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    verification: result.verification,
    oneTimeLink: result.oneTimeLink,
    reused: result.reused,
  });
}

async function getMockCompleteKyc(req: NextRequest, dealId: string): Promise<NextResponse> {
  if (!isMockVendorsEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const inquiryId = req.nextUrl.searchParams.get("inquiryId");
  if (!inquiryId) {
    return htmlResponse("Missing inquiryId.", 400);
  }

  const sb = supabaseAdmin();
  const { data: verification } = await sb
    .from("borrower_identity_verifications")
    .select("id, deal_id")
    .eq("vendor_inquiry_id", inquiryId)
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!verification) {
    return htmlResponse("No matching mock verification found for this deal.", 404);
  }

  const result = await handlePersonaWebhook(
    { inquiry_id: inquiryId },
    {
      sb,
      persona: {
        createPersonaInquiry: mockCreatePersonaInquiry,
        fetchPersonaInquiry: mockFetchPersonaInquiry,
        generatePersonaOneTimeLink: (id: string) => Promise.resolve(buildMockPersonaOneTimeLink(dealId, id)),
      },
    },
  );

  if (!result.ok) {
    return htmlResponse(`Mock KYC completion failed: ${result.reason}`, 500);
  }

  return htmlResponse(
    "✅ [TEST MODE] Identity verified. This is a mock verification, not a real one — you can close this tab.",
    200,
  );
}

async function getEsignStatus(req: NextRequest, dealId: string): Promise<NextResponse> {
  const submissionId = req.nextUrl.searchParams.get("submissionId");
  if (!submissionId) {
    return NextResponse.json({ ok: false, error: "missing_submissionId_query_param" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: signedDoc } = await sb
    .from("signed_documents")
    .select("*")
    .eq("deal_id", dealId)
    .eq("docuseal_submission_id", submissionId)
    .maybeSingle();

  if (signedDoc) {
    return NextResponse.json({ ok: true, status: "completed", signedDocument: signedDoc });
  }

  const submission = await fetchDocusealSubmission(submissionId);
  return NextResponse.json({ ok: true, status: submission.status, submission });
}

async function postEsign(req: NextRequest, dealId: string, bankId: string): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const {
    form_code: formCode,
    template_version: templateVersion,
    signer_ownership_entity_id: signerOwnershipEntityId,
    signer_role: signerRole,
    signer_email: signerEmail,
    signer_name: signerName,
  } = body as Record<string, unknown>;

  if (
    typeof formCode !== "string" ||
    typeof templateVersion !== "string" ||
    typeof signerOwnershipEntityId !== "string" ||
    typeof signerRole !== "string" ||
    !SIGNER_ROLES.has(signerRole) ||
    typeof signerEmail !== "string" ||
    typeof signerName !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // The signer must be an owner of THIS deal — a borrower on deal A must
  // never be able to request a signature against an ownershipEntityId that
  // belongs to deal B (same invariant as the kyc handler).
  const { data: owner } = await sb
    .from("ownership_entities")
    .select("id")
    .eq("id", signerOwnershipEntityId)
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!owner) {
    return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
  }

  const signatureArgs = {
    dealId,
    bankId,
    formCode,
    templateVersion,
    signerOwnershipEntityId,
    signerRole: signerRole as any,
    signerEmail,
    signerName,
  };

  const result = isMockVendorsEnabled()
    ? await mockRequestSignature(signatureArgs, { sb: supabaseAdmin() })
    : await requestSignature(signatureArgs, {
        sb: supabaseAdmin(),
        docuseal: { createDocusealSubmission, fetchDocusealSubmission, downloadDocusealSignedPdf, downloadDocusealAuditTrail },
      });

  if (!result.ok) {
    const status = result.reason === "IAL2_NOT_COMPLETED" ? 403 : 502;
    return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, submission_id: result.submissionId, embed_url: result.embedUrl });
}

async function getMockCompleteEsign(req: NextRequest, dealId: string): Promise<NextResponse> {
  if (!isMockVendorsEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const submissionId = req.nextUrl.searchParams.get("submissionId");
  const externalId = req.nextUrl.searchParams.get("externalId");
  if (!submissionId || !externalId || !externalId.startsWith(`deal:${dealId}:`)) {
    return htmlResponse("Missing or mismatched submission for this deal.", 400);
  }

  const sb = supabaseAdmin();
  const result = await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: externalId, id: submissionId, submission_id: submissionId } },
    {
      sb,
      docuseal: {
        createDocusealSubmission: mockCreateDocusealSubmission,
        fetchDocusealSubmission: mockFetchDocusealSubmission,
        downloadDocusealSignedPdf: mockDownloadDocusealSignedPdf,
        downloadDocusealAuditTrail: mockDownloadDocusealAuditTrail,
      },
    },
  );

  if (!result.ok) {
    return htmlResponse(`Mock e-sign completion failed: ${result.reason}`, 500);
  }

  return htmlResponse(
    "✅ [TEST MODE] Document signed. This is a mock signature, not a real one — you can close this tab.",
    200,
  );
}

function htmlResponse(message: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="font-family: sans-serif; padding: 2rem;"><p>${message}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function getFormsStatus(dealId: string): Promise<NextResponse> {
  const result = await getBrokerageFormsStatus(dealId, supabaseAdmin());
  if (!result.ok) {
    return NextResponse.json({ ok: true, packageRun: null, items: [] });
  }
  return NextResponse.json({ ok: true, packageRun: result.packageRun, items: result.items });
}

async function postPrepareForms(dealId: string): Promise<NextResponse> {
  const result = await prepareBrokerageSbaForms(dealId, supabaseAdmin());
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    packageRunId: result.packageRunId,
    itemCount: result.itemCount,
    reused: result.reused,
  });
}

async function postGenerateForms(req: NextRequest, dealId: string): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const onlyItemId = typeof body?.onlyItemId === "string" ? body.onlyItemId : undefined;

  const result = await generateBrokerageForms(dealId, supabaseAdmin(), { onlyItemId });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: result.reason === "NO_PACKAGE_RUN" ? 400 : 404 },
    );
  }
  return NextResponse.json({ ok: true, results: result.results });
}

async function postAssembleForms(dealId: string): Promise<NextResponse> {
  const result = await assembleBrokerageFormsPackage(dealId, supabaseAdmin());
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, detail: "detail" in result ? result.detail : undefined },
      { status: result.reason === "NO_PACKAGE_RUN" || result.reason === "PACKAGE_RUN_NOT_FOUND" ? 404 : 422 },
    );
  }
  return NextResponse.json({
    ok: true,
    storagePath: result.storagePath,
    itemCount: result.itemCount,
    missingItems: result.missingItems,
  });
}
