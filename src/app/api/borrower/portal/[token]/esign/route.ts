import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requestSignature } from "@/lib/esign/signwell/service";
import {
  createSignwellDocumentFromFile,
  deleteSignwellDocument,
  fetchSignwellDocument,
  downloadSignwellCompletedPdf,
} from "@/lib/esign/signwell/client";
import { resolveFilledPdfForSigning } from "@/lib/esign/signwell/resolveFilledPdfForSigning";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

const SIGNER_ROLES = new Set(["applicant", "guarantor", "spouse", "agent", "witness"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

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
      dealId: ctx.dealId,
      bankId: ctx.bankId,
      formCode,
      templateVersion,
      signerOwnershipEntityId,
      signerRole: signerRole as "applicant" | "guarantor" | "spouse" | "agent" | "witness",
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
    const status =
      result.reason === "IAL2_NOT_COMPLETED" ? 403
        : result.reason === "LEGAL_REVIEW_NOT_COMPLETED" ? 403
          : 502;
    return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
  }

  return NextResponse.json({ ok: true, submission_id: result.documentId, embed_url: result.embedUrl });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const { data: docs } = await sb
    .from("signed_documents")
    .select("id, form_code, signer_ownership_entity_id, signer_role, signature_completed_at, expires_at")
    .eq("deal_id", ctx.dealId)
    .order("signature_completed_at", { ascending: false });

  const { data: pending } = await sb
    .from("signing_requests")
    .select("id, form_code, signer_ownership_entity_id, signer_role, status, signing_url, created_at")
    .eq("deal_id", ctx.dealId)
    .neq("status", "Completed");

  return NextResponse.json({
    ok: true,
    signedDocuments: docs ?? [],
    pendingRequests: pending ?? [],
  });
}
