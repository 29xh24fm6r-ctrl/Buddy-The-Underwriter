import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { renderDecisionPdf } from "@/lib/pdf/decisionPdf";
import { getActiveLetterhead, downloadLetterheadBuffer } from "@/lib/bank/letterhead";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { dealId, snapshotId } = await ctx.params;

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch snapshot (tenant-scoped via deal)
  const { data: deal } = await sb.from("deals").select("id, bank_id").eq("id", dealId).single();

  if (!deal || deal.bank_id !== bankId) {
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

    return new NextResponse(pdfBuffer, {
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
