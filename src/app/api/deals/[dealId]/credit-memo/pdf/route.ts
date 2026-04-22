import "server-only";

import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { buildDealIntelligence } from "@/lib/dealIntelligence/buildDealIntelligence";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;

function renderCreditMemoPdf(intel: Awaited<ReturnType<typeof buildDealIntelligence>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 48 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Credit Memo Draft — AI v1", { align: "center" });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Deal: ${intel.deal.id}`);
    doc.text(`Borrower: ${intel.deal.borrower_name}`);
    doc.text(`Stage: ${intel.deal.stage}`);
    doc.text(`Generated: ${intel.memoDraft.generatedAt}`);
    doc.moveDown();

    doc.fontSize(12).text("Executive Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(intel.memoDraft.executiveSummary);
    doc.moveDown();

    doc.fontSize(12).text("Borrower Overview", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(intel.memoDraft.borrowerOverview);
    doc.moveDown();

    doc.fontSize(12).text("Loan Request", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(intel.memoDraft.loanRequest);
    doc.moveDown();

    doc.fontSize(12).text("Collateral Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(intel.memoDraft.collateralSummary);
    doc.moveDown();

    doc.fontSize(12).text("Document / Checklist Status", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(intel.memoDraft.documentChecklistStatus);
    doc.moveDown();

    doc.fontSize(12).text("Risk Factors", { underline: true });
    doc.moveDown(0.5);
    (intel.memoDraft.riskFactors.length ? intel.memoDraft.riskFactors : ["None identified"]).forEach((risk) => {
      doc.fontSize(10).text(`• ${risk}`);
    });
    doc.moveDown();

    doc.fontSize(12).text("Open Items / Conditions", { underline: true });
    doc.moveDown(0.5);
    (intel.memoDraft.openItems.length ? intel.memoDraft.openItems : ["None"]).forEach((item) => {
      doc.fontSize(10).text(`• ${item}`);
    });
    doc.moveDown();

    doc.fontSize(12).text("Recent Activity", { underline: true });
    doc.moveDown(0.5);
    (intel.memoDraft.recentActivity.length ? intel.memoDraft.recentActivity : ["None"]).forEach((item) => {
      doc.fontSize(10).text(`• ${item}`);
    });
    doc.moveDown();

    if (intel.memoDraft.assumptions.length) {
      doc.fontSize(12).text("Assumptions / Missing Data", { underline: true });
      doc.moveDown(0.5);
      intel.memoDraft.assumptions.forEach((item) => {
        doc.fontSize(10).text(`• ${item}`);
      });
    }

    doc.end();
  });
}

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;

  // Phase 81: Trust enforcement — block committee-looking PDFs for non-committee research
  const { loadAndEnforceResearchTrust } = await import("@/lib/research/trustEnforcement");
  const trustCheck = await loadAndEnforceResearchTrust(dealId, "committee_packet");
  if (!trustCheck.allowed) {
    return NextResponse.json(
      { ok: false, error: trustCheck.reason },
      { status: 400 },
    );
  }

  const intelligence = await buildDealIntelligence(dealId);
  const pdf = await renderCreditMemoPdf(intelligence);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="credit-memo-${dealId}.pdf"`,
    },
  });
}
