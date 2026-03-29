import "server-only";

import PDFDocument from "pdfkit";
import type {
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  SensitivityScenario,
  UseOfProceedsLine,
  ManagementMember,
} from "./sbaReadinessTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_NORMAL = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_SIZE_BODY = 9;
const FONT_SIZE_HEADER = 11;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 12;
const FONT_SIZE_SMALL = 7;
const PAGE_MARGIN = 40;
const HEADER_HEIGHT = 50;
const FOOTER_HEIGHT = 40;
const ROW_HEIGHT = 16;

const SBA_DSCR_THRESHOLD = 1.25;

const DISCLAIMER =
  "This document is prepared for informational purposes only and does not constitute a commitment to lend. " +
  "All projections are based on assumptions provided by the borrower and have not been independently verified. " +
  "Past performance is not indicative of future results.";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtCurrency(val: number): string {
  if (val < 0) {
    return `(${Math.abs(val).toLocaleString("en-US", { maximumFractionDigits: 0 })})`;
  }
  return val.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

function fmtDscr(val: number): string {
  return `${val.toFixed(2)}x`;
}

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------

interface RenderInput {
  dealName: string;
  loanType: string;
  loanAmount: number;
  baseYear: AnnualProjectionYear;
  annualProjections: AnnualProjectionYear[];
  monthlyProjections: MonthlyProjection[];
  breakEven: BreakEvenResult;
  sensitivityScenarios: SensitivityScenario[];
  useOfProceeds: UseOfProceedsLine[];
  businessOverviewNarrative: string;
  sensitivityNarrative: string;
  managementTeam: ManagementMember[];
}

type DocState = {
  doc: PDFKit.PDFDocument;
  y: number;
  pageNum: number;
  input: RenderInput;
};

function drawPageHeader(s: DocState, sectionTitle: string) {
  const { doc, input } = s;
  const rightEdge = doc.page.width - PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_TITLE);
  doc.text("SBA Business Plan & Financial Projections", PAGE_MARGIN, PAGE_MARGIN, {
    width: rightEdge - PAGE_MARGIN,
  });

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_HEADER);
  doc.text(input.dealName, PAGE_MARGIN, PAGE_MARGIN + 18);
  doc.text(
    `${input.loanType.replace(/_/g, " ").toUpperCase()} — $${input.loanAmount.toLocaleString()}`,
    rightEdge - 200,
    PAGE_MARGIN + 18,
    { width: 200, align: "right" },
  );

  const ruleY = PAGE_MARGIN + HEADER_HEIGHT - 4;
  doc
    .moveTo(PAGE_MARGIN, ruleY)
    .lineTo(rightEdge, ruleY)
    .lineWidth(0.5)
    .stroke("#333333");

  s.y = PAGE_MARGIN + HEADER_HEIGHT + 4;

  if (sectionTitle) {
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_SECTION);
    doc.text(sectionTitle, PAGE_MARGIN, s.y);
    s.y += 20;
  }
}

function drawPageFooter(s: DocState) {
  const { doc } = s;
  const bottomY = doc.page.height - FOOTER_HEIGHT;
  const rightEdge = doc.page.width - PAGE_MARGIN;

  doc
    .moveTo(PAGE_MARGIN, bottomY)
    .lineTo(rightEdge, bottomY)
    .lineWidth(0.3)
    .stroke("#999999");

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL);
  doc.text(DISCLAIMER, PAGE_MARGIN, bottomY + 4, {
    width: rightEdge - PAGE_MARGIN,
    lineGap: 1,
  });

  doc.text(`Page ${s.pageNum}`, rightEdge - 50, bottomY + 4, {
    width: 50,
    align: "right",
  });
}

function newPage(s: DocState, sectionTitle: string) {
  drawPageFooter(s);
  s.doc.addPage();
  s.pageNum++;
  drawPageHeader(s, sectionTitle);
}

function checkPageBreak(s: DocState, neededHeight: number, sectionTitle: string) {
  const bottomLimit = s.doc.page.height - FOOTER_HEIGHT - 20;
  if (s.y + neededHeight > bottomLimit) {
    newPage(s, sectionTitle);
  }
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderSection1_BusinessOverview(s: DocState) {
  const { doc, input } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  doc.text(input.businessOverviewNarrative, PAGE_MARGIN, s.y, {
    width: maxWidth,
    lineGap: 2,
  });
  s.y = doc.y + 16;
}

function renderSection2_Projections(s: DocState) {
  const { doc, input } = s;
  const allYears = [input.baseYear, ...input.annualProjections];
  const colLabels = ["", "Base Year", "Year 1", "Year 2", "Year 3"];
  const colWidths = [140, 95, 95, 95, 95];
  const startX = PAGE_MARGIN;

  // Header row
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, { width: colWidths[i], align: i > 0 ? "right" : "left" });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc.moveTo(startX, s.y - 2).lineTo(startX + 520, s.y - 2).lineWidth(0.3).stroke("#cccccc");

  const rows: Array<{ label: string; values: number[]; bold?: boolean; pct?: boolean }> = [
    { label: "Revenue", values: allYears.map((y) => y.revenue) },
    { label: "COGS", values: allYears.map((y) => y.cogs) },
    { label: "Gross Profit", values: allYears.map((y) => y.grossProfit), bold: true },
    { label: "Gross Margin", values: allYears.map((y) => y.grossMarginPct), pct: true },
    { label: "Operating Expenses", values: allYears.map((y) => y.operatingExpenses) },
    { label: "EBITDA", values: allYears.map((y) => y.ebitda), bold: true },
    { label: "Depreciation", values: allYears.map((y) => y.depreciation) },
    { label: "EBIT", values: allYears.map((y) => y.ebit) },
    { label: "Tax Estimate", values: allYears.map((y) => y.taxEstimate) },
    { label: "Net Income", values: allYears.map((y) => y.netIncome), bold: true },
    { label: "Total Debt Service", values: allYears.map((y) => y.totalDebtService) },
    { label: "DSCR", values: allYears.map((y) => y.dscr) },
  ];

  for (const row of rows) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Section 2: 3-Year Financial Projections (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.text(row.label, x, s.y, { width: colWidths[0] });
    x += colWidths[0];

    for (let i = 0; i < row.values.length; i++) {
      const val = row.values[i];
      let display: string;
      if (row.pct) {
        display = fmtPct(val);
      } else if (row.label === "DSCR") {
        display = fmtDscr(val);
        // Red if below SBA threshold
        if (val < SBA_DSCR_THRESHOLD && i > 0) {
          doc.fillColor("#cc0000");
        }
      } else {
        display = `$${fmtCurrency(val)}`;
      }
      doc.text(display, x, s.y, { width: colWidths[i + 1], align: "right" });
      doc.fillColor("#000000");
      x += colWidths[i + 1];
    }
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

function renderSection3_MonthlyCF(s: DocState) {
  const { doc, input } = s;

  // Monthly table — 13 columns (label + 12 months), smaller font
  const labelW = 100;
  const monthW = 36;
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(7);
  let x = startX;
  doc.text("", x, s.y, { width: labelW });
  x += labelW;
  for (let m = 1; m <= 12; m++) {
    doc.text(`M${m}`, x, s.y, { width: monthW, align: "right" });
    x += monthW;
  }
  s.y += ROW_HEIGHT;
  doc.moveTo(startX, s.y - 2).lineTo(startX + labelW + 12 * monthW, s.y - 2).lineWidth(0.3).stroke("#cccccc");

  const monthlyRows: Array<{ label: string; getter: (m: MonthlyProjection) => number; bold?: boolean }> = [
    { label: "Revenue", getter: (m) => m.revenue },
    { label: "Operating Costs", getter: (m) => m.operatingDisbursements },
    { label: "Net Operating CF", getter: (m) => m.netOperatingCF, bold: true },
    { label: "Debt Service", getter: (m) => m.debtService },
    { label: "Net Cash", getter: (m) => m.netCash },
    { label: "Cumulative Cash", getter: (m) => m.cumulativeCash, bold: true },
  ];

  for (const row of monthlyRows) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Section 3: Monthly Cash Flow — Year 1 (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(7);
    x = startX;
    doc.text(row.label, x, s.y, { width: labelW });
    x += labelW;

    for (const mp of input.monthlyProjections) {
      const val = row.getter(mp);
      // Red for negative cumulative cash
      if (row.label === "Cumulative Cash" && val < 0) {
        doc.fillColor("#cc0000");
      }
      doc.text(fmtCurrency(Math.round(val)), x, s.y, { width: monthW, align: "right" });
      doc.fillColor("#000000");
      x += monthW;
    }
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

function renderSection4_BreakEven(s: DocState) {
  const { doc, input } = s;
  const be = input.breakEven;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  const lines = [
    `Annual Fixed Costs: $${fmtCurrency(be.fixedCostsAnnual)}`,
    `Contribution Margin: ${fmtPct(be.contributionMarginPct)}`,
    `Break-Even Revenue: $${fmtCurrency(be.breakEvenRevenue)}`,
    `Projected Year 1 Revenue: $${fmtCurrency(be.projectedRevenueYear1)}`,
    `Margin of Safety: ${fmtPct(be.marginOfSafetyPct)}`,
  ];

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  for (const line of lines) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Section 4: Break-Even Analysis (cont.)");
    doc.text(line, PAGE_MARGIN, s.y, { width: maxWidth });
    s.y += ROW_HEIGHT;
  }

  if (be.flagLowMargin) {
    s.y += 4;
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.fillColor("#b45309");
    doc.text(
      "Warning: Margin of safety is below 10%. Revenue shortfalls could quickly erode debt service capacity.",
      PAGE_MARGIN,
      s.y,
      { width: maxWidth },
    );
    doc.fillColor("#000000");
    s.y = doc.y + 8;
  }

  s.y += 8;
}

function renderSection5_Sensitivity(s: DocState) {
  const { doc, input } = s;

  // Sensitivity table
  const colWidths = [120, 70, 65, 65, 65, 70];
  const colLabels = ["Scenario", "Y1 Revenue", "DSCR Y1", "DSCR Y2", "DSCR Y3", "SBA 1.25x"];
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, { width: colWidths[i], align: i > 0 ? "right" : "left" });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc.moveTo(startX, s.y - 2).lineTo(startX + 455, s.y - 2).lineWidth(0.3).stroke("#cccccc");

  for (const scenario of input.sensitivityScenarios) {
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.text(scenario.label, x, s.y, { width: colWidths[0] });
    x += colWidths[0];

    doc.text(`$${fmtCurrency(scenario.revenueYear1)}`, x, s.y, { width: colWidths[1], align: "right" });
    x += colWidths[1];

    // DSCR values — red if below threshold
    for (const dscr of [scenario.dscrYear1, scenario.dscrYear2, scenario.dscrYear3]) {
      if (dscr < SBA_DSCR_THRESHOLD) doc.fillColor("#cc0000");
      doc.text(fmtDscr(dscr), x, s.y, { width: 65, align: "right" });
      doc.fillColor("#000000");
      x += 65;
    }

    // Pass/fail
    if (scenario.passesSBAThreshold) {
      doc.fillColor("#15803d");
      doc.text("\u2713 Pass", x, s.y, { width: colWidths[5], align: "right" });
    } else {
      doc.fillColor("#cc0000");
      doc.text("\u2717 Below 1.25x", x, s.y, { width: colWidths[5], align: "right" });
    }
    doc.fillColor("#000000");
    s.y += ROW_HEIGHT;
  }

  s.y += 12;

  // Gemini sensitivity narrative
  if (input.sensitivityNarrative) {
    const maxWidth = doc.page.width - PAGE_MARGIN * 2;
    checkPageBreak(s, 80, "Section 5: Sensitivity Analysis (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text("Commentary", PAGE_MARGIN, s.y);
    s.y += 14;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text(input.sensitivityNarrative, PAGE_MARGIN, s.y, { width: maxWidth, lineGap: 2 });
    s.y = doc.y + 8;
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderSBAPackagePDF(input: RenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const s: DocState = { doc, y: 0, pageNum: 1, input };

    // === Section 1: Business Overview ===
    drawPageHeader(s, "Section 1: Business Overview");
    renderSection1_BusinessOverview(s);

    // === Section 2: 3-Year Financial Projections ===
    newPage(s, "Section 2: 3-Year Financial Projections");
    renderSection2_Projections(s);

    // === Section 3: Monthly Cash Flow — Year 1 ===
    newPage(s, "Section 3: Monthly Cash Flow \u2014 Year 1");
    renderSection3_MonthlyCF(s);

    // === Section 4: Break-Even Analysis ===
    newPage(s, "Section 4: Break-Even Analysis");
    renderSection4_BreakEven(s);

    // === Section 5: Sensitivity Analysis ===
    newPage(s, "Section 5: Sensitivity Analysis");
    renderSection5_Sensitivity(s);

    // Final footer on last page
    drawPageFooter(s);

    doc.end();
  });
}
