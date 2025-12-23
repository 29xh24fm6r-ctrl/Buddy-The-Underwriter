import PDFDocument from "pdfkit";
import type { CreditMemoContent } from "../memo/generateCreditMemoJson";

/**
 * Render credit memo JSON to PDF
 * 
 * This is a simplified example using pdfkit.
 * Enhance with your existing PDF rendering infrastructure.
 */
export async function renderCreditMemoPdf(
  content: CreditMemoContent,
  dealId: string,
  docId: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).text("Credit Memorandum", { align: "center" });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Deal: ${content.header.deal_name}`);
    doc.text(`Borrower: ${content.header.borrower}`);
    doc.text(`Date: ${content.header.date}`);
    doc.text(`Prepared by: ${content.header.prepared_by}`);
    doc.moveDown();

    // Executive Summary
    doc.fontSize(14).text("Executive Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(content.executive_summary.narrative);
    doc.moveDown();

    doc.fontSize(12).text("Key Risks:");
    content.executive_summary.key_risks.forEach((risk) => {
      doc.fontSize(10).text(`• ${risk}`, { indent: 20 });
    });
    doc.moveDown();

    doc.fontSize(12).text("Mitigants:");
    content.executive_summary.mitigants.forEach((mitigant) => {
      doc.fontSize(10).text(`• ${mitigant}`, { indent: 20 });
    });
    doc.moveDown(2);

    // Transaction Overview
    doc.fontSize(14).text("Transaction Overview", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Amount: ${formatCurrency(content.transaction_overview.loan_request.amount)}`);
    doc.text(`Purpose: ${content.transaction_overview.loan_request.purpose}`);
    doc.text(`Term: ${content.transaction_overview.loan_request.term_months} months`);
    doc.moveDown(2);

    // Borrower/Sponsor
    doc.fontSize(14).text("Borrower & Sponsor", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(content.borrower_sponsor.background);
    doc.text(content.borrower_sponsor.experience);
    doc.text(content.borrower_sponsor.guarantor_strength);
    doc.moveDown(2);

    // Collateral
    doc.fontSize(14).text("Collateral Analysis", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(content.collateral.property_description);
    doc.text(content.collateral.market_analysis);
    if (content.collateral.valuation.as_is) {
      doc.text(`As-Is Value: ${formatCurrency(content.collateral.valuation.as_is)}`);
    }
    if (content.collateral.valuation.stabilized) {
      doc.text(`Stabilized Value: ${formatCurrency(content.collateral.valuation.stabilized)}`);
    }
    doc.moveDown(2);

    // Financial Analysis
    doc.fontSize(14).text("Financial Analysis", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(content.financial_analysis.income_analysis);
    if (content.financial_analysis.dscr) {
      doc.text(`DSCR: ${content.financial_analysis.dscr.toFixed(2)}x`);
    }
    doc.moveDown(2);

    // Risk Factors
    if (content.risk_factors.length > 0) {
      doc.fontSize(14).text("Risk Factors", { underline: true });
      doc.moveDown(0.5);
      content.risk_factors.forEach((rf) => {
        doc.fontSize(10);
        doc.font("Helvetica-Bold").text(`${rf.risk} (${rf.severity})`);
        doc.font("Helvetica");
        rf.mitigants.forEach((m) => {
          doc.text(`  • ${m}`, { indent: 20 });
        });
        doc.moveDown(0.5);
      });
      doc.moveDown();
    }

    // Policy Exceptions
    if (content.policy_exceptions.length > 0) {
      doc.fontSize(14).text("Policy Exceptions", { underline: true });
      doc.moveDown(0.5);
      content.policy_exceptions.forEach((pe) => {
        doc.fontSize(10);
        doc.font("Helvetica-Bold").text(pe.exception);
        doc.font("Helvetica");
        doc.text(`Rationale: ${pe.rationale}`);
        doc.moveDown(0.5);
      });
      doc.moveDown();
    }

    // Proposed Terms (if available)
    if (content.proposed_terms) {
      doc.addPage();
      doc.fontSize(14).text("Proposed Terms", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Product: ${content.proposed_terms.product}`);
      doc.text(`Rate: ${(content.proposed_terms.rate.all_in_rate * 100).toFixed(2)}%`);
      doc.text(`  ${content.proposed_terms.rate.index} + ${content.proposed_terms.rate.margin_bps}bps`);
      doc.moveDown();
      doc.text("Fees:");
      doc.text(`  Origination: ${formatCurrency(content.proposed_terms.fees.origination)}`);
      doc.text(`  Underwriting: ${formatCurrency(content.proposed_terms.fees.underwriting)}`);
      doc.text(`  Legal: ${formatCurrency(content.proposed_terms.fees.legal)}`);
      doc.moveDown();
      doc.text(`Rationale: ${content.proposed_terms.rationale}`);
    }

    // Footer
    doc.fontSize(8).text(
      `Generated: ${new Date().toISOString()} | Deal ID: ${dealId} | Doc ID: ${docId}`,
      50,
      doc.page.height - 50,
      { align: "center" }
    );

    doc.end();
  });
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
