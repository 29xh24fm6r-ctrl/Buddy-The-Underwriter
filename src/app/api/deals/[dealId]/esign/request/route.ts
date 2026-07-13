import "server-only";

/** SPEC S3 B-7 — POST /api/deals/[dealId]/esign/request */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { requestSignature } from "@/lib/esign/docuseal/service";
import {
  createDocusealSubmission,
  fetchDocusealSubmission,
  downloadDocusealSignedPdf,
  downloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/client";
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
        sb: supabaseAdmin(),
        docuseal: { createDocusealSubmission, fetchDocusealSubmission, downloadDocusealSignedPdf, downloadDocusealAuditTrail },
      },
    );

    if (!result.ok) {
      const status = result.reason === "IAL2_NOT_COMPLETED" ? 403 : 502;
      return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
    }

    return NextResponse.json({ ok: true, submission_id: result.submissionId, embed_url: result.embedUrl });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/esign/request]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
