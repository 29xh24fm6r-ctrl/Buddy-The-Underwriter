import "server-only";

/**
 * Projections preview PDF — borrower-facing, mode="preview" only.
 *
 * Renders ONLY the summary metrics the borrower has earned the right to
 * see pre-pick:
 *   - Year 1 revenue
 *   - Year 1 DSCR
 *   - Break-even month
 *
 * Detailed monthly / annual / sensitivity tables are NOT rendered. This
 * is the data-layer redaction the spec requires — the renderer never
 * receives the raw cells, so they can't be uncovered by inspecting the
 * PDF, copying the page, or removing a watermark layer. The full
 * workbook ships only on lender pick (Sprint 6).
 *
 * Diagonal "PREVIEW — NOT FOR DISTRIBUTION" watermark is applied to
 * every page as a defense-in-depth signal, but the redaction is the
 * actual security control.
 */

import PDFDocument from "pdfkit";

const FONT_NORMAL = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const PAGE_MARGIN = 54;

export type ProjectionsPreviewInput = {
  dealName: string;
  year1Revenue: number | null;
  year1Dscr: number | null;
  breakEvenMonth: number | null; // 1–36, or null if not computed
  generatedAt?: string;
};

export async function renderProjectionsPreviewPdf(
  input: ProjectionsPreviewInput,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: PAGE_MARGIN,
      bufferPages: true, // required for switchToPage in applyPreviewWatermark
      info: {
        Title: `Projections Preview — ${input.dealName}`,
        Author: "Buddy",
        Subject: "SBA financial projections (preview)",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title block
    doc
      .font(FONT_BOLD)
      .fontSize(20)
      .text("Financial Projections", { align: "left" })
      .moveDown(0.25);
    doc
      .font(FONT_NORMAL)
      .fontSize(11)
      .fillColor("#475569")
      .text(input.dealName, { align: "left" })
      .moveDown(1.5);

    // Summary callouts — only the three metrics the spec allows pre-pick.
    drawMetric(doc, "Year 1 Revenue", formatMoney(input.year1Revenue));
    doc.moveDown(0.75);
    drawMetric(doc, "Year 1 DSCR", formatRatio(input.year1Dscr));
    doc.moveDown(0.75);
    drawMetric(doc, "Break-Even Month", formatMonth(input.breakEvenMonth));
    doc.moveDown(2);

    // Unlock note in lieu of detailed tables.
    doc
      .font(FONT_BOLD)
      .fontSize(12)
      .fillColor("#1e293b")
      .text("Detailed monthly + annual workbook", { align: "left" })
      .moveDown(0.25);
    doc
      .font(FONT_NORMAL)
      .fontSize(11)
      .fillColor("#475569")
      .text(
        "[Unlocks when you pick a lender on Buddy]",
        { align: "left" },
      )
      .moveDown(0.5);
    doc
      .font(FONT_NORMAL)
      .fontSize(10)
      .fillColor("#64748b")
      .text(
        "Your full projections workbook — monthly cash flow, annual P&L, sensitivity scenarios, and use-of-proceeds — is generated and held in escrow. It releases to you (and to the lender you pick) the moment you confirm your lender selection.",
        { align: "left", lineGap: 2 },
      );

    // Footer / generated-at
    doc
      .font(FONT_NORMAL)
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        `Generated ${input.generatedAt ?? new Date().toISOString()} · Buddy SBA preview`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN,
        { align: "left", width: doc.page.width - 2 * PAGE_MARGIN },
      );

    applyPreviewWatermark(doc);
    doc.end();
  });
}

function drawMetric(doc: PDFKit.PDFDocument, label: string, value: string) {
  const startY = doc.y;
  doc
    .font(FONT_NORMAL)
    .fontSize(10)
    .fillColor("#64748b")
    .text(label.toUpperCase(), { characterSpacing: 1 });
  doc
    .font(FONT_BOLD)
    .fontSize(28)
    .fillColor("#0f172a")
    .text(value);
  // Anchor next callout below the previous one.
  if (doc.y < startY) doc.y = startY + 50;
}

function formatMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function formatRatio(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}x`;
}

function formatMonth(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const m = Math.round(v);
  if (m <= 0) return "—";
  return `Month ${m}`;
}

/**
 * Diagonal translucent "PREVIEW — NOT FOR DISTRIBUTION" watermark on every
 * page. Cosmetic — the actual security is the omission of the raw cells.
 */
function applyPreviewWatermark(doc: PDFKit.PDFDocument): void {
  const pages = (doc as unknown as { bufferedPageRange(): { count: number } })
    .bufferedPageRange()
    .count;
  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.fillColor("#cbd5e1").fillOpacity(0.35);
    doc.font(FONT_BOLD).fontSize(48);
    const cx = doc.page.width / 2;
    const cy = doc.page.height / 2;
    doc.rotate(-30, { origin: [cx, cy] });
    doc.text("PREVIEW — NOT FOR DISTRIBUTION", 0, cy - 24, {
      width: doc.page.width,
      align: "center",
    });
    doc.restore();
  }
}
