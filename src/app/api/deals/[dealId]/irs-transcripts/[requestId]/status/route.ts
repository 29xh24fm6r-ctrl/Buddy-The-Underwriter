import "server-only";

/** SPEC S4 D-3 — GET /api/deals/[dealId]/irs-transcripts/[requestId]/status */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; requestId: string }> };

const ETA_DAYS_BY_STATUS: Record<string, string> = {
  pending_signature: "Awaiting borrower e-signature on Form 4506-C",
  submitted: "3-10 days from submission",
  received: "Transcripts received — reconciliation in progress",
  reconciled: "Complete",
  failed: "Failed — see status_reason",
  expired: "Not received within 14 days — banker follow-up may be required",
};

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, requestId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

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
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/irs-transcripts/[requestId]/status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
