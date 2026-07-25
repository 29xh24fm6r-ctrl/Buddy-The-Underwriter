import "server-only";
import PDFDocument from "pdfkit";
import type { SbaNoteBuildResult } from "@/lib/sba/forms/sbaNote/build";

/**
 * Generates the Note from scratch with PDFKit (no template PDF exists for
 * this — see fields.ts). Every page carries a persistent banner: draft
 * until src/lib/sba/legalReview/service.ts's gate shows this deal's
 * FORM_SBA_NOTE review as approved, then an attributed "reviewed and
 * approved" banner — the banner never disappears entirely, so the
 * document's Buddy-AI provenance stays visible even after execution.
 *
 * "Signature of Borrower" and the date line are left blank for SignWell,
 * same convention as every AcroForm-fill form in this arc.
 */

export type RenderSbaNoteResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "INCOMPLETE" | "RENDER_FAILED"; detail?: string };

const COLORS = {
  black: "#111418",
  gray: "#4B5563",
  lightGray: "#9CA3AF",
  lineGray: "#E5E7EB",
  headerBg: "#1E293B",
  draftRed: "#B91C1C",
  approvedGreen: "#15803D",
};

function fmtMoney(val: number | null): string {
  if (val == null) return "[TO BE DETERMINED]";
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(val: number | null): string {
  if (val == null) return "[TO BE DETERMINED]";
  return `${val.toFixed(3)}%`;
}

export async function renderSbaNotePdf(args: { buildResult: SbaNoteBuildResult }): Promise<RenderSbaNoteResult> {
  const { buildResult } = args;
  if (!buildResult.is_complete) {
    return { ok: false, reason: "INCOMPLETE", detail: buildResult.missing.join(", ") };
  }

  const f = buildResult.input;
  const review = buildResult.legal_review;

  try {
    const pdfBytes = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: "letter",
        margins: { top: 72, bottom: 64, left: 60, right: 60 },
        info: { Title: `Promissory Note — ${f.borrower_legal_name}`, Subject: "SBA Promissory Note (Buddy-drafted)" },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const L = doc.page.margins.left;

      function drawBanner() {
        const bannerColor = review.approved ? COLORS.approvedGreen : COLORS.draftRed;
        const text = review.approved
          ? `PREPARED BY BUDDY AI — REVIEWED AND APPROVED FOR EXECUTION${review.reviewed_at ? ` (${new Date(review.reviewed_at).toLocaleDateString()})` : ""}`
          : "DRAFT — PREPARED BY BUDDY AI — REQUIRES ATTORNEY REVIEW BEFORE EXECUTION";
        doc.save();
        doc.rect(0, 0, doc.page.width, 22).fill(bannerColor);
        doc.fillColor("#FFFFFF").fontSize(7).font("Helvetica-Bold").text(text, L, 7, { width: pageWidth, align: "center" });
        doc.restore();
        doc.fillColor(COLORS.black);
        doc.y = 72;
      }

      function newPage() {
        doc.addPage();
        drawBanner();
      }

      function checkPageBreak(neededPx = 60) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - neededPx) {
          newPage();
        }
      }

      function sectionHeader(title: string) {
        checkPageBreak(40);
        doc.moveDown(0.6);
        const y = doc.y;
        doc.rect(L, y, pageWidth, 16).fill(COLORS.headerBg);
        doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold").text(title.toUpperCase(), L + 6, y + 4, { width: pageWidth - 12 });
        doc.fillColor(COLORS.black);
        doc.y = y + 22;
      }

      function paragraph(text: string) {
        checkPageBreak(50);
        doc.fontSize(9.5).font("Helvetica").fillColor(COLORS.black).text(text, L, doc.y, { width: pageWidth, align: "left", lineGap: 2 });
        doc.moveDown(0.5);
      }

      function labelValue(label: string, value: string) {
        checkPageBreak(20);
        doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.gray).text(label, L, doc.y, { continued: true, width: 180 });
        doc.font("Helvetica").fillColor(COLORS.black).text(`  ${value}`, { width: pageWidth - 180 });
      }

      function divider() {
        const y = doc.y + 4;
        doc.moveTo(L, y).lineTo(L + pageWidth, y).strokeColor(COLORS.lineGray).lineWidth(0.5).stroke();
        doc.y = y + 8;
      }

      // ── Page 1 ──
      drawBanner();

      doc.fontSize(15).font("Helvetica-Bold").fillColor(COLORS.black).text("PROMISSORY NOTE", L, doc.y, { width: pageWidth, align: "center" });
      doc.moveDown(1);

      labelValue("Borrower:", f.borrower_legal_name ?? "");
      labelValue("Lender:", f.lender_name ?? "");
      labelValue("Principal Amount:", fmtMoney(f.principal_amount));
      labelValue("Date:", "[DATE OF EXECUTION]");
      divider();

      sectionHeader("1. Promise to Pay");
      paragraph(
        `In return for a loan, Borrower promises to pay to the order of Lender the principal amount of ${fmtMoney(
          f.principal_amount,
        )}, together with interest on the unpaid principal balance, in the manner and on the terms set forth in this Note. ` +
          `This loan is being made under the U.S. Small Business Administration ("SBA") ${f.rate_type === "variable" ? "7(a) variable-rate" : "7(a)"} loan program and is subject to current SBA regulations and the terms of the SBA guaranty of this loan.`,
      );

      sectionHeader("2. Interest Rate");
      const rateDesc =
        f.rate_type === "variable"
          ? `a variable rate equal to ${f.rate_index ?? "the applicable SBA base rate"} plus ${f.rate_spread_bps != null ? `${(f.rate_spread_bps / 100).toFixed(3)}%` : "the approved spread"}, currently ${fmtPct(f.interest_rate_pct)} per annum, adjusted as permitted under SBA regulations`
          : `a fixed rate of ${fmtPct(f.interest_rate_pct)} per annum`;
      paragraph(`Interest on the unpaid principal balance will accrue at ${rateDesc}, computed on the basis of the actual number of days elapsed over a 360-day year.`);

      sectionHeader("3. Payment Terms");
      paragraph(
        `Borrower will pay principal and interest in ${f.payment_frequency ?? "monthly"} installments over a term of ${f.term_months ?? "[TERM]"} months` +
          (f.amort_months && f.amort_months !== f.term_months ? `, amortized over ${f.amort_months} months` : "") +
          (f.interest_only_months ? `, with the first ${f.interest_only_months} months interest-only` : "") +
          `. Payments will be applied first to accrued interest, then to principal. The entire unpaid principal balance, together with accrued and unpaid interest, is due and payable in full at the end of the loan term.`,
      );

      sectionHeader("4. Late Charge");
      paragraph(f.late_charge_text);

      sectionHeader("5. Prepayment");
      paragraph(f.prepayment_penalty_text);

      sectionHeader("6. Use of Proceeds");
      paragraph(`Borrower will use the proceeds of this loan solely as follows: ${f.use_of_proceeds_summary ?? "[USE OF PROCEEDS]"}.`);

      if (f.collateral_summary.length > 0) {
        sectionHeader("7. Collateral");
        paragraph(`This Note is secured by the following collateral: ${f.collateral_summary.join("; ")}, as further described in the applicable security instruments.`);
      }

      if (f.guarantors.length > 0) {
        sectionHeader("8. Guarantors");
        paragraph(
          `This Note is guaranteed by: ${f.guarantors.map((g) => `${g.name}${g.type ? ` (${g.type} guaranty)` : ""}`).join("; ")}, pursuant to separate guaranty agreements executed in connection with this loan.`,
        );
      }

      sectionHeader("9. Default");
      paragraph(
        "Borrower will be in default under this Note if Borrower does not make a payment when due, fails to comply with any obligation under this Note or any agreement securing this loan, defaults on any other loan with Lender, or if certain adverse events specified in the Loan Authorization & Agreement occur (including without limitation the borrower's death, insolvency, or a materially adverse change in condition). Upon default, Lender may require Borrower to immediately pay the entire unpaid principal balance, accrued unpaid interest, and any other amounts owed, subject to SBA's right to require Lender to seek recovery of any deficiency.",
      );

      sectionHeader("10. SBA Guaranty");
      paragraph(
        "When SBA is the holder of this Note, this Note will be interpreted and enforced under federal law, including SBA regulations. Lender or SBA may use state or local procedures for filing papers, recording documents, giving notice, foreclosing liens, and other purposes, but by using such procedures SBA does not waive any federal immunity from state or local control, penalty, tax, or liability.",
      );

      checkPageBreak(120);
      sectionHeader("Signature");
      doc.moveDown(2);
      doc.fontSize(9).font("Helvetica").fillColor(COLORS.black).text("Borrower Signature: ______________________________     Date: ______________", L, doc.y);
      doc.moveDown(0.5);
      doc.text(f.borrower_legal_name ?? "", L, doc.y);

      doc.end();
    });

    return { ok: true, pdfBytes };
  } catch (err: any) {
    return { ok: false, reason: "RENDER_FAILED", detail: err?.message ?? String(err) };
  }
}
