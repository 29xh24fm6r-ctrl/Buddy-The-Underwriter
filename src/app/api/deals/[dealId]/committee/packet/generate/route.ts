import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderDecisionPdf } from "@/lib/pdf/decisionPdf";
import { getActiveLetterhead, downloadLetterheadBuffer } from "@/lib/bank/letterhead";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";
import { buildPricingMemoAppendixPdfBytes } from "@/app/api/deals/[dealId]/pricing/quote/[quoteId]/memo-pdf/route";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/committee/packet/generate
 *
 * One-click CTA to generate a committee packet for the deal.
 * Called from LifecycleStatusPanel when user clicks "Generate Packet".
 *
 * This endpoint:
 * 1. Finds the latest decision snapshot
 * 2. Generates the committee packet PDF (with optional pricing appendix)
 * 3. Logs the event to mark packet as ready
 *
 * Returns:
 * - ok: true, snapshotId: string - Successfully generated
 * - ok: false, error: string - Error occurred
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { userId } = await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    const sb = supabaseAdmin();

    // Get latest decision snapshot
    const { data: snapshot, error: snapErr } = await sb
      .from("decision_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapErr) {
      console.error("[committee/packet/generate] Snapshot query error:", snapErr);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch decision snapshot" },
        { status: 500 }
      );
    }

    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "No decision snapshot found. Complete underwriting first." },
        { status: 400 }
      );
    }

    // Fetch bank letterhead
    let letterheadBuffer: Buffer | null = null;
    try {
      const letterhead = await getActiveLetterhead(access.bankId);
      if (letterhead) {
        letterheadBuffer = await downloadLetterheadBuffer(letterhead.bucket, letterhead.path);
      }
    } catch (err) {
      console.warn("[committee/packet/generate] Letterhead fetch failed, continuing without:", err);
    }

    // Generate PDF
    const pdfBuffer = await renderDecisionPdf(snapshot, letterheadBuffer);

    // Try to add pricing appendix
    let finalPdfBuffer = pdfBuffer;
    let appendixQuoteId: string | null = null;

    try {
      appendixQuoteId = await getLatestLockedQuoteId(sb, dealId);
      if (appendixQuoteId) {
        const appendixBytes = await buildPricingMemoAppendixPdfBytes({
          sb,
          bankId: access.bankId,
          dealId,
          quoteId: appendixQuoteId,
        });

        if (appendixBytes) {
          const baseDoc = await PdfLibDocument.load(pdfBuffer);
          const appendixDoc = await PdfLibDocument.load(appendixBytes);
          const merged = await PdfLibDocument.create();

          const basePages = await merged.copyPages(baseDoc, baseDoc.getPageIndices());
          basePages.forEach((page) => merged.addPage(page));

          const appendixPages = await merged.copyPages(appendixDoc, appendixDoc.getPageIndices());
          appendixPages.forEach((page) => merged.addPage(page));

          const mergedBytes = await merged.save();
          finalPdfBuffer = Buffer.from(mergedBytes);
        }
      }
    } catch (err) {
      console.warn("[committee/packet/generate] Appendix generation failed, continuing without:", err);
    }

    // Log the event to mark packet as generated
    // This makes committeePacketReady = true in lifecycle state
    await writeEvent({
      dealId,
      kind: "deal.committee.packet.generated",
      actorUserId: userId,
      meta: {
        snapshotId: snapshot.id,
        quoteId: appendixQuoteId,
        pdfSizeBytes: finalPdfBuffer.length,
        source: "one_click_cta",
      },
    });

    return NextResponse.json({
      ok: true,
      snapshotId: snapshot.id,
      pdfSizeBytes: finalPdfBuffer.length,
      hasAppendix: !!appendixQuoteId,
    });
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/committee/packet/generate] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
