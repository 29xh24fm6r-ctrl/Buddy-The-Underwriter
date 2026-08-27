import "server-only";

/**
 * SPEC S3 B-7 — /api/deals/[dealId]/esign
 * POST -> request a signature (SignWell document)
 * GET  ?submissionId=... -> document status
 *
 * Consolidates the former separate esign/request (POST) and
 * esign/status/[submissionId] (GET) route files into one file — route/page
 * slot budget discipline (see the Drift Log). The POST path changes from
 * /esign/request to /esign (caller updated: SbaSigningPanel.tsx); GET had
 * no caller. Vendor is SignWell (replaces DocuSeal — see
 * docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md item 3).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import {
  isFailedTerminalSigningRequestStatus,
  persistSignwellRequestStatus,
  requestSignature,
} from "@/lib/esign/signwell/service";
import { createSignwellDocumentFromFile, deleteSignwellDocument, fetchSignwellDocument, downloadSignwellCompletedPdf } from "@/lib/esign/signwell/client";
import { resolveFilledPdfForSigning } from "@/lib/esign/signwell/resolveFilledPdfForSigning";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const SIGNER_ROLES = new Set(["applicant", "guarantor", "spouse", "agent", "witness"]);

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);

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
    const result = await requestSignature(
      {
        dealId,
        bankId,
        formCode,
        templateVersion,
        signerOwnershipEntityId,
        signerRole: signerRole as any,
        signerEmail,
        signerName,
      },
      {
        sb,
        signwell: { createSignwellDocumentFromFile, deleteSignwellDocument, fetchSignwellDocument, downloadSignwellCompletedPdf },
        renderFilledPdf: (a) => resolveFilledPdfForSigning({ ...a, supabase: sb }),
      },
    );

    if (!result.ok) {
      const status = result.reason === "IAL2_NOT_COMPLETED" ? 403 : 502;
      return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
    }

    return NextResponse.json({ ok: true, submission_id: result.documentId, embed_url: result.embedUrl });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/esign] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const submissionId = new URL(req.url).searchParams.get("submissionId");
    if (!submissionId) {
      return NextResponse.json({ ok: false, error: "missing_submissionId_query_param" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: signedDoc } = await sb
      .from("signed_documents")
      .select("*")
      .eq("deal_id", dealId)
      .eq("esign_document_id", submissionId)
      .maybeSingle();

    if (signedDoc) {
      return NextResponse.json({ ok: true, status: "completed", signedDocument: signedDoc });
    }

    // Bind every provider lookup to a request owned by this deal. Without
    // this check, a user with access to deal A could probe a guessed
    // SignWell document id belonging to deal B.
    const { data: signingRequest } = await sb
      .from("signing_requests")
      .select("id")
      .eq("deal_id", dealId)
      .eq("signwell_document_id", submissionId)
      .maybeSingle();
    if (!signingRequest) {
      return NextResponse.json({ ok: false, error: "submission_not_found" }, { status: 404 });
    }

    const document = await fetchSignwellDocument(submissionId);
    if (isFailedTerminalSigningRequestStatus(document.status)) {
      const persisted = await persistSignwellRequestStatus(
        { dealId, documentId: submissionId, status: document.status },
        sb,
      );
      if (!persisted.ok) {
        return NextResponse.json(
          { ok: false, error: "status_reconciliation_failed", detail: persisted.detail },
          { status: 503 },
        );
      }
    }
    return NextResponse.json({ ok: true, status: document.status, submission: document });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/esign] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
