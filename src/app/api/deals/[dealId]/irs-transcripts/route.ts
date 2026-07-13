import "server-only";

/**
 * SPEC S4 D-3 — /api/deals/[dealId]/irs-transcripts
 * POST -> submit a transcript request
 * GET  ?requestId=... -> status of a previously submitted request
 *
 * Consolidates the former separate irs-transcripts/submit (POST) and
 * irs-transcripts/[requestId]/status (GET) route files into one file (no
 * UI caller used either by their old paths, confirmed before this
 * restructure) — route/page slot budget discipline (see the Drift Log).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { downloadPrivateObject } from "@/lib/storage/adminStorage";
import { submitTranscriptRequest } from "@/lib/integrations/irsTranscripts/submission";
import { submitVendorTranscriptRequest, currentIrsVendor } from "@/lib/integrations/irsTranscripts/client";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const ETA_DAYS_BY_STATUS: Record<string, string> = {
  pending_signature: "Awaiting borrower e-signature on Form 4506-C",
  submitted: "3-10 days from submission",
  received: "Transcripts received — reconciliation in progress",
  reconciled: "Complete",
  failed: "Failed — see status_reason",
  expired: "Not received within 14 days — banker follow-up may be required",
};

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);

    const body = await req.json().catch(() => null);
    const ownershipEntityId: string | undefined = body?.ownership_entity_id;
    const borrowerId: string | undefined = body?.borrower_id;
    const signed4506cId: string | undefined = body?.signed_4506c_id;
    const taxYears: unknown = body?.tax_years;
    const transcriptTypes: unknown = body?.transcript_types;

    if (!signed4506cId || typeof signed4506cId !== "string") {
      return NextResponse.json({ ok: false, error: "missing_signed_4506c_id" }, { status: 400 });
    }
    if (!Array.isArray(taxYears) || taxYears.length === 0 || !taxYears.every((y) => typeof y === "number")) {
      return NextResponse.json({ ok: false, error: "invalid_tax_years" }, { status: 400 });
    }
    if (!Array.isArray(transcriptTypes) || transcriptTypes.length === 0) {
      return NextResponse.json({ ok: false, error: "invalid_transcript_types" }, { status: 400 });
    }

    const result = await submitTranscriptRequest(
      { dealId, bankId, ownershipEntityId: ownershipEntityId ?? null, borrowerId: borrowerId ?? null, signed4506cId, taxYears, transcriptTypes },
      {
        sb: supabaseAdmin(),
        vendor: { submitVendorTranscriptRequest, currentIrsVendor },
        downloadSigned4506cPdf: async (storagePath: string) => {
          const bytes = await downloadPrivateObject({ bucket: "signed-documents", path: storagePath });
          return Buffer.from(bytes);
        },
      },
    );

    if (!result.ok) {
      const status = result.reason === "SIGNED_4506C_NOT_FOUND" ? 404 : result.reason === "MISSING_SUBJECT" ? 400 : 502;
      return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
    }

    return NextResponse.json({ ok: true, request_id: result.requestId, status: result.status, reused: result.reused });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/irs-transcripts] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const requestId = new URL(req.url).searchParams.get("requestId");
    if (!requestId) {
      return NextResponse.json({ ok: false, error: "missing_requestId_query_param" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: request } = await sb
      .from("borrower_irs_transcript_requests")
      .select("id, status, status_reason, submitted_at, received_at, tax_years, transcript_types, reconciliation_summary")
      .eq("id", requestId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!request) {
      return NextResponse.json({ ok: false, error: "request_not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, request, eta: ETA_DAYS_BY_STATUS[request.status] ?? null });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/irs-transcripts] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
