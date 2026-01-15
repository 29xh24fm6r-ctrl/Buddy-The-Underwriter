import "server-only";

import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { buildDealIntelligence } from "@/lib/dealIntelligence/buildDealIntelligence";

export const runtime = "nodejs";

function renderConditionsPdf(intel: Awaited<ReturnType<typeof buildDealIntelligence>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 48 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const requiredMissing = intel.conditions.missingDocs.filter((d) => d.required);
    const optionalMissing = intel.conditions.missingDocs.filter((d) => !d.required);

    doc.fontSize(18).text("Conditions & Missing Docs", { align: "center" });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Deal: ${intel.deal.id}`);
    doc.text(`Borrower: ${intel.deal.borrower_name}`);
    doc.text(`Stage: ${intel.deal.stage}`);
    doc.moveDown();

    doc.fontSize(12).text("Required Missing Documents", { underline: true });
    doc.moveDown(0.5);
    (requiredMissing.length ? requiredMissing : [{ label: "None" } as any]).forEach((item) => {
      doc.fontSize(10).text(`• ${item.label}`);
    });
    doc.moveDown();

    doc.fontSize(12).text("Optional Missing Documents", { underline: true });
    doc.moveDown(0.5);
    (optionalMissing.length ? optionalMissing : [{ label: "None" } as any]).forEach((item) => {
      doc.fontSize(10).text(`• ${item.label}`);
    });
    doc.moveDown();

    doc.fontSize(12).text("Open Conditions", { underline: true });
    doc.moveDown(0.5);
    (intel.conditions.open.length ? intel.conditions.open : [{ label: "None", status: "" } as any]).forEach((item) => {
      doc.fontSize(10).text(`• ${item.label}${item.status ? ` (${item.status})` : ""}`);
    });
    doc.moveDown();

    if (intel.assumptions.length) {
      doc.fontSize(12).text("Assumptions / Missing Data", { underline: true });
      doc.moveDown(0.5);
      intel.assumptions.forEach((item) => {
        doc.fontSize(10).text(`• ${item}`);
      });
    }

    doc.end();
  });
}

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const intelligence = await buildDealIntelligence(dealId);
  const pdf = await renderConditionsPdf(intelligence);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="conditions-${dealId}.pdf"`,
    },
  });
}
