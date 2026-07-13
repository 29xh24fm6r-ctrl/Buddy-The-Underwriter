import "server-only";

import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { buildDealIntelligence } from "@/lib/dealIntelligence/buildDealIntelligence";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadLatestCertifiedFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/loadLatestCertifiedSnapshot";

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

    doc.fontSize(20).text("Informal AI Deal Summary — Working Draft", { align: "center" });
    doc.moveDown(0.25);
    doc.fontSize(9).fillColor("#b45309").text(
      "This is NOT the official credit memo. It is an early-stage AI summary for internal working reference only, generated before a canonical credit memo exists for this deal.",
      { align: "center" },
    );
    doc.fillColor("black");
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;

  // This route had no tenant-ownership check at all — any authenticated (or
  // even unauthenticated, depending on middleware) caller who knew/guessed a
  // dealId could pull another bank's deal intelligence. Same class of gap
  // fixed on the citations/geometry/generate routes earlier.
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  // Prefer the real thing: once a certified Florida Armory memo exists for
  // this deal, this route's informal AI summary is superseded by it — redirect
  // there instead of serving a document a reader could mistake for the
  // official, committee-safety-checked credit memo.
  const certified = await loadLatestCertifiedFloridaArmorySnapshot({
    dealId,
    bankId: access.bankId,
  });
  if (certified.ok) {
    return NextResponse.redirect(
      new URL(`/api/deals/${dealId}/credit-memo/canonical/pdf`, req.nextUrl.origin),
      307,
    );
  }

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
      "content-disposition": `inline; filename="ai-deal-summary-draft-${dealId}.pdf"`,
    },
  });
}
