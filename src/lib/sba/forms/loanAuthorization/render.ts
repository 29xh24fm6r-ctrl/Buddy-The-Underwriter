import "server-only";
import PDFDocument from "pdfkit";
import type { LoanAuthorizationBuildResult } from "@/lib/sba/forms/loanAuthorization/build";

/**
 * Generates the Loan Authorization & Agreement from scratch with PDFKit —
 * same rationale, banner convention, and caveats as sbaNote/render.ts.
 */

export type RenderLoanAuthorizationResult =
  | { ok: true; pdfBytes: Buffer }
  | { ok: false; reason: "INCOMPLETE" | "RENDER_FAILED"; detail?: string };

const COLORS = {
  black: "#111418",
  gray: "#4B5563",
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

export async function renderLoanAuthorizationPdf(args: {
  buildResult: LoanAuthorizationBuildResult;
}): Promise<RenderLoanAuthorizationResult> {
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
        info: { Title: `Loan Authorization & Agreement — ${f.borrower_legal_name}`, Subject: "SBA Loan Authorization & Agreement (Buddy-drafted)" },
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

      function bulletList(items: string[]) {
        for (const item of items) {
          checkPageBreak(40);
          doc.fontSize(9.5).font("Helvetica").fillColor(COLORS.black).text(`•  ${item}`, L + 4, doc.y, { width: pageWidth - 4, lineGap: 1 });
          doc.moveDown(0.3);
        }
        doc.moveDown(0.3);
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

      doc.fontSize(15).font("Helvetica-Bold").fillColor(COLORS.black).text("LOAN AUTHORIZATION & AGREEMENT", L, doc.y, { width: pageWidth, align: "center" });
      doc.moveDown(1);

      labelValue("Borrower:", f.borrower_legal_name ?? "");
      labelValue("Lender:", f.lender_name ?? "");
      labelValue("Loan Amount:", fmtMoney(f.principal_amount));
      labelValue("Interest Rate:", `${fmtPct(f.interest_rate_pct)}${f.rate_type ? ` (${f.rate_type})` : ""}`);
      labelValue("Term:", f.term_months != null ? `${f.term_months} months` : "[TERM]");
      labelValue("Use of Proceeds:", f.use_of_proceeds_summary ?? "");
      divider();

      paragraph(
        "This Loan Authorization & Agreement sets forth the terms and conditions under which Lender will make the above-described loan to Borrower, " +
          "including as guaranteed by the U.S. Small Business Administration (\"SBA\") under its 7(a) Loan Program. Borrower's execution of this " +
          "Authorization constitutes Borrower's agreement to comply with all of its terms and conditions.",
      );

      sectionHeader("1. Conditions Precedent to Disbursement");
      paragraph("Before any funds are disbursed under this loan, the following conditions must be satisfied to Lender's reasonable satisfaction:");
      bulletList(f.conditions_precedent);

      if (f.collateral_summary.length > 0) {
        sectionHeader("2. Collateral");
        paragraph(`This loan is secured by the following collateral: ${f.collateral_summary.join("; ")}, as further described in the applicable security instruments.`);
      }

      if (f.guarantors.length > 0) {
        sectionHeader("3. Guarantors");
        paragraph(
          `The following individuals/entities will execute guaranty agreements in connection with this loan: ${f.guarantors
            .map((g) => `${g.name}${g.type ? ` (${g.type} guaranty)` : ""}`)
            .join("; ")}.`,
        );
      }

      sectionHeader("4. Reporting & Financial Covenants");
      if (f.deal_covenants.length > 0) {
        paragraph("Borrower will comply with the following financial covenants, tested at the frequency indicated:");
        bulletList(f.deal_covenants.map((c) => `${c.metric}: ${c.threshold}, tested ${c.testing_frequency}.`));
      } else {
        paragraph("No deal-specific financial covenants have been recorded for this loan as of the date of this Authorization.");
      }
      bulletList(f.affirmative_covenants);

      sectionHeader("5. Negative Covenants");
      paragraph("Unless Lender otherwise agrees in writing, Borrower will not:");
      bulletList(f.negative_covenants);

      sectionHeader("6. Conditions Subsequent");
      paragraph("Following disbursement, Borrower will continue to satisfy the following ongoing conditions:");
      bulletList(f.conditions_subsequent);

      sectionHeader("7. Default & Remedies");
      paragraph(
        "An Event of Default under this Authorization occurs upon any default under the Note, any guaranty, or any security instrument executed in " +
          "connection with this loan, or upon Borrower's failure to comply with any term of this Authorization. Upon an Event of Default, Lender " +
          "may exercise any remedy available under the Note, applicable security instruments, or applicable law, including acceleration of the " +
          "entire unpaid balance, subject to any notice and cure rights required by SBA regulations.",
      );

      sectionHeader("8. Governing Law");
      paragraph(
        "This Authorization is prepared pursuant to SBA loan program requirements. When SBA is the holder of the Note, this Authorization is governed " +
          "by federal law. Lender or SBA may use state or local procedures for purposes such as filing papers, recording documents, giving notice, and " +
          "enforcing liens, without waiving federal preemption where applicable.",
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
