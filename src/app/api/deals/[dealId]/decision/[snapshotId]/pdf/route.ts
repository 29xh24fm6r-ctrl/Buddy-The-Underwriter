import { NextResponse } from "next/server";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { renderDecisionPdf } from "@/lib/pdf/decisionPdf";
import { getActiveLetterhead, downloadLetterheadBuffer } from "@/lib/bank/letterhead";
import { fetchDealBankId } from "@/lib/deals/fetchDealContext";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";
import { buildPricingMemoAppendixPdfBytes } from "@/app/api/deals/[dealId]/pricing/quote/[quoteId]/memo-pdf/route";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { dealId, snapshotId } = await ctx.params;

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch deal via canonical context endpoint (ensures tenant enforcement)
  const dealBankId = await fetchDealBankId(dealId);

  if (dealBankId !== bankId) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .single();

  if (error || !snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  // Fetch bank letterhead (if exists)
  let letterheadBuffer: Buffer | null = null;
  try {
    const letterhead = await getActiveLetterhead(bankId);
    if (letterhead) {
      letterheadBuffer = await downloadLetterheadBuffer(letterhead.bucket, letterhead.path);
    }
  } catch (err) {
    console.error("Failed to fetch letterhead, continuing without:", err);
    // Continue without letterhead if fetch fails
  }

  // Generate PDF
  try {
    const pdfBuffer = await renderDecisionPdf(snapshot, letterheadBuffer);

    let appendixBytes: Uint8Array | null = null;
    let appendixQuoteId: string | null = null;

    try {
      appendixQuoteId = await getLatestLockedQuoteId(sb, dealId);
      if (!appendixQuoteId) {
        console.info("committee packet: no locked quote, appendix not attached", {
          dealId,
          snapshotId,
        });
      } else {
        appendixBytes = await buildPricingMemoAppendixPdfBytes({
          sb,
          bankId,
          dealId,
          quoteId: appendixQuoteId,
        });
        console.info("committee packet: pricing appendix attached", {
          dealId,
          snapshotId,
          quoteId: appendixQuoteId,
        });
      }
    } catch (error) {
      console.warn("committee packet: pricing appendix skipped", {
        dealId,
        snapshotId,
        quoteId: appendixQuoteId,
        error,
      });
      appendixBytes = null;
    }

    let finalPdfBuffer = pdfBuffer;
    if (appendixBytes) {
      try {
        const baseDoc = await PdfLibDocument.load(pdfBuffer);
        const appendixDoc = await PdfLibDocument.load(appendixBytes);
        const merged = await PdfLibDocument.create();

        const basePages = await merged.copyPages(
          baseDoc,
          baseDoc.getPageIndices(),
        );
        basePages.forEach((page) => merged.addPage(page));

        const appendixPages = await merged.copyPages(
          appendixDoc,
          appendixDoc.getPageIndices(),
        );
        appendixPages.forEach((page) => merged.addPage(page));

        const mergedBytes = await merged.save();
        finalPdfBuffer = Buffer.from(mergedBytes);
      } catch (error) {
        console.warn("committee packet: pricing appendix merge failed", {
          dealId,
          snapshotId,
          quoteId: appendixQuoteId,
          error,
        });
      }
    }

    return new NextResponse(finalPdfBuffer as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="decision-${snapshotId.slice(0, 8)}.pdf"`,
        "Cache-Control": "public, max-age=31536000, immutable", // Snapshots are immutable
      },
    });
  } catch (err: any) {
    console.error("PDF generation error:", err);
    return NextResponse.json({ error: "PDF generation failed", details: err.message }, { status: 500 });
  }
}
