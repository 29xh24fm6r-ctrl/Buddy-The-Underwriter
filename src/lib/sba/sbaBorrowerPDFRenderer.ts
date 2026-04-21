import "server-only";

// src/lib/sba/sbaBorrowerPDFRenderer.ts
// Phase 85-BPG-EXPERIENCE — Borrower-facing projection PDF.
// A 6-page plain-English business plan the borrower downloads at the end of
// intake. Reuses the same PDFKit patterns as sbaPackageRenderer but with a
// narrower section set and borrower-appropriate tone.

import PDFDocument from "pdfkit";
import type {
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  SensitivityScenario,
} from "./sbaReadinessTypes";
import type {
  Milestone,
  MilestoneCategory,
  KPITarget,
  RiskContingency,
} from "./sbaBusinessPlanRoadmap";
import type { BorrowerStory } from "./sbaBorrowerStory";

// ─── Constants ────────────────────────────────────────────────────────────

const FONT_NORMAL = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_SIZE_BODY = 10;
const FONT_SIZE_HEADER = 11;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 12;
const FONT_SIZE_SMALL = 7;
const PAGE_MARGIN = 40;
const HEADER_HEIGHT = 50;
const FOOTER_HEIGHT = 40;
const ROW_HEIGHT = 16;

const BRAND_NAVY = "#0f1e3c";
const BRAND_BLUE = "#2563eb";
const BRAND_GREY = "#6b7280";
const SERIES_GREY = "#94a3b8";
const SERIES_NAVY = "#1e3a8a";
const SERIES_BLUE = "#2563eb";
const SERIES_AMBER = "#d97706";
const DSCR_RED = "#cc0000";
const PASS_GREEN = "#15803d";

const SBA_DSCR_THRESHOLD = 1.25;

const DISCLAIMER =
  "This document is prepared for planning purposes based on the assumptions you provided. " +
  "Figures are projections, not guarantees. Consult your accountant or financial advisor before making major business decisions.";

// ─── Formatting helpers ──────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────

export interface BorrowerPDFInput {
  businessName: string;
  loanAmount: number;
  loanType: string;
  baseYear: AnnualProjectionYear;
  annualProjections: AnnualProjectionYear[];
  monthlyProjections: MonthlyProjection[];
  breakEven: BreakEvenResult;
  sensitivityScenarios: SensitivityScenario[];
  researchBriefing: string;
  actionableRoadmap: string;
  generatedDate: string;
  // God Tier Business Plan additions — all OPTIONAL; pages are skipped when absent
  planThesis?: string | null;
  milestoneTimeline?: Milestone[] | null;
  kpiDashboard?: KPITarget[] | null;
  riskContingencyMatrix?: RiskContingency[] | null;
  borrowerStory?: BorrowerStory | null;
}

type DocState = {
  doc: PDFKit.PDFDocument;
  y: number;
  pageNum: number;
  input: BorrowerPDFInput;
};

// ─── Page chrome ──────────────────────────────────────────────────────────

function drawPageHeader(s: DocState, sectionTitle: string) {
  const { doc, input } = s;
  const rightEdge = doc.page.width - PAGE_MARGIN;

  doc.fillColor("#000000");
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_TITLE);
  doc.text("Your Business Plan", PAGE_MARGIN, PAGE_MARGIN, {
    width: rightEdge - PAGE_MARGIN,
  });

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_HEADER).fillColor(BRAND_GREY);
  doc.text(input.businessName, PAGE_MARGIN, PAGE_MARGIN + 18);

  const ruleY = PAGE_MARGIN + HEADER_HEIGHT - 4;
  doc
    .moveTo(PAGE_MARGIN, ruleY)
    .lineTo(rightEdge, ruleY)
    .lineWidth(0.5)
    .stroke("#333333");

  s.y = PAGE_MARGIN + HEADER_HEIGHT + 4;
  doc.fillColor("#000000");

  if (sectionTitle) {
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_SECTION);
    doc.text(sectionTitle, PAGE_MARGIN, s.y);
    s.y += 22;
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

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_GREY);
  doc.text(DISCLAIMER, PAGE_MARGIN, bottomY + 4, {
    width: rightEdge - PAGE_MARGIN - 60,
    lineGap: 1,
  });

  doc.text(`Page ${s.pageNum}`, rightEdge - 50, bottomY + 4, {
    width: 50,
    align: "right",
  });
  doc.fillColor("#000000");
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

function renderNarrativeBody(s: DocState, text: string, sectionTitle: string) {
  if (!text) return;
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  const paragraphs = text.split(/\n\n+/);
  for (const p of paragraphs) {
    checkPageBreak(s, 40, sectionTitle);
    doc.text(p.trim(), PAGE_MARGIN, s.y, { width: maxWidth, lineGap: 2.5 });
    s.y = doc.y + 10;
  }
}

// ─── Cover page (borrower-friendly) ───────────────────────────────────────

function renderCoverPage(s: DocState) {
  const { doc, input } = s;
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Blue top bar
  doc.rect(0, 0, pageW, 90).fill(BRAND_BLUE);

  doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(22);
  doc.text("Buddy", PAGE_MARGIN, 32, { width: pageW - PAGE_MARGIN * 2 });
  doc.font(FONT_NORMAL).fontSize(11);
  doc.text("Your AI Business Advisor", PAGE_MARGIN, 60);

  // Main title
  const titleY = pageH / 3;
  doc.fillColor(BRAND_NAVY).font(FONT_BOLD).fontSize(32);
  doc.text("Your Business Plan", PAGE_MARGIN, titleY, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });
  doc.fontSize(20);
  doc.text("& Financial Projections", PAGE_MARGIN, titleY + 40, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Business name
  doc.fillColor("#000000").font(FONT_BOLD).fontSize(18);
  doc.text(input.businessName, PAGE_MARGIN, titleY + 110, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Loan context
  doc.font(FONT_NORMAL).fontSize(13).fillColor(BRAND_GREY);
  const loanLabel = input.loanType.replace(/_/g, " ").toUpperCase();
  doc.text(
    `${loanLabel} Loan Request — $${input.loanAmount.toLocaleString()}`,
    PAGE_MARGIN,
    titleY + 138,
    { width: pageW - PAGE_MARGIN * 2, align: "center" },
  );

  doc.text(input.generatedDate, PAGE_MARGIN, titleY + 158, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Prepared-by block
  const prepY = pageH - 180;
  doc.fillColor(BRAND_NAVY).font(FONT_BOLD).fontSize(10);
  doc.text("PREPARED BY", PAGE_MARGIN, prepY, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });
  doc.font(FONT_NORMAL).fontSize(9).fillColor(BRAND_GREY);
  doc.text(
    "Buddy's AI advisor analyzed your industry, benchmarked your numbers against " +
      "thousands of similar businesses, and built this plan using the assumptions " +
      "you confirmed. Share it with your partners, accountant, or banker.",
    PAGE_MARGIN + 60,
    prepY + 16,
    { width: pageW - PAGE_MARGIN * 2 - 120, align: "center", lineGap: 2 },
  );

  doc.fillColor("#000000");
  s.pageNum = 1;
  s.y = pageH;
}

// ─── Revenue bar chart ────────────────────────────────────────────────────

function renderRevenueChart(s: DocState) {
  const { doc, input } = s;
  const chartY = s.y;
  const chartH = 160;
  const chartW = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 70;
  const plotX = PAGE_MARGIN + labelW;
  const plotW = chartW - labelW - 10;
  const allYears = [input.baseYear, ...input.annualProjections];
  const maxRev = Math.max(...allYears.map((y) => y.revenue), 1);
  const barGap = 20;
  const barCount = allYears.length;
  const barW = (plotW - barGap * (barCount - 1)) / barCount;

  doc
    .strokeColor(BRAND_GREY)
    .moveTo(plotX, chartY)
    .lineTo(plotX, chartY + chartH)
    .lineTo(plotX + plotW, chartY + chartH)
    .stroke();

  for (let i = 0; i < barCount; i++) {
    const yr = allYears[i];
    const barX = plotX + i * (barW + barGap);
    const barH = (yr.revenue / maxRev) * (chartH - 20);
    const topY = chartY + chartH - barH;
    const fill = yr.label === "Actual" ? SERIES_GREY : SERIES_NAVY;
    doc.rect(barX, topY, barW, barH).fill(fill);
    doc
      .fillColor("#000000")
      .font(FONT_BOLD)
      .fontSize(8)
      .text(`$${fmtCurrency(Math.round(yr.revenue))}`, barX, topY - 12, {
        width: barW,
        align: "center",
      });
    doc
      .fillColor(BRAND_GREY)
      .font(FONT_NORMAL)
      .fontSize(8)
      .text(
        yr.label === "Actual" ? "Base Year" : `Year ${yr.year}`,
        barX,
        chartY + chartH + 4,
        { width: barW, align: "center" },
      );
  }
  doc.fillColor("#000000").strokeColor("#000000");
  s.y = chartY + chartH + 30;
}

// ─── DSCR chart ───────────────────────────────────────────────────────────

function renderDSCRChart(s: DocState) {
  const { doc, input } = s;
  const chartY = s.y;
  const chartH = 140;
  const chartW = doc.page.width - PAGE_MARGIN * 2;
  const labelW = 60;
  const plotX = PAGE_MARGIN + labelW;
  const plotW = chartW - labelW - 10;

  const scenarios: Array<{ name: string; color: string; dscrs: number[] }> = [];
  for (const sc of input.sensitivityScenarios) {
    const color =
      sc.name === "base"
        ? SERIES_NAVY
        : sc.name === "upside"
          ? SERIES_BLUE
          : SERIES_AMBER;
    scenarios.push({
      name: sc.label,
      color,
      dscrs: [sc.dscrYear1, sc.dscrYear2, sc.dscrYear3],
    });
  }
  if (scenarios.length === 0) {
    scenarios.push({
      name: "Base",
      color: SERIES_NAVY,
      dscrs: [
        input.annualProjections[0]?.dscr ?? 0,
        input.annualProjections[1]?.dscr ?? 0,
        input.annualProjections[2]?.dscr ?? 0,
      ],
    });
  }
  const allD = scenarios.flatMap((sc) => sc.dscrs);
  const dMax = Math.max(...allD, SBA_DSCR_THRESHOLD * 1.2, 1);
  const dMin = 0;

  doc
    .strokeColor(BRAND_GREY)
    .moveTo(plotX, chartY)
    .lineTo(plotX, chartY + chartH)
    .lineTo(plotX + plotW, chartY + chartH)
    .stroke();

  const thresholdY =
    chartY + chartH - ((SBA_DSCR_THRESHOLD - dMin) / (dMax - dMin)) * chartH;
  doc
    .strokeColor(DSCR_RED)
    .dash(3, { space: 3 })
    .moveTo(plotX, thresholdY)
    .lineTo(plotX + plotW, thresholdY)
    .stroke()
    .undash();
  doc
    .fillColor(DSCR_RED)
    .font(FONT_BOLD)
    .fontSize(7)
    .text("Target 1.25x", plotX + plotW - 80, thresholdY - 10, {
      width: 80,
      align: "right",
    });

  const xs = [0.2, 0.5, 0.85].map((f) => plotX + plotW * f);
  for (const sc of scenarios) {
    doc.strokeColor(sc.color).lineWidth(1.5);
    for (let i = 0; i < sc.dscrs.length - 1; i++) {
      const y1 =
        chartY + chartH - ((sc.dscrs[i] - dMin) / (dMax - dMin)) * chartH;
      const y2 =
        chartY +
        chartH -
        ((sc.dscrs[i + 1] - dMin) / (dMax - dMin)) * chartH;
      doc.moveTo(xs[i], y1).lineTo(xs[i + 1], y2).stroke();
    }
    for (let i = 0; i < sc.dscrs.length; i++) {
      const yy =
        chartY + chartH - ((sc.dscrs[i] - dMin) / (dMax - dMin)) * chartH;
      doc.fillColor(sc.color).circle(xs[i], yy, 3).fill();
    }
  }

  doc.fillColor(BRAND_GREY).font(FONT_NORMAL).fontSize(8);
  for (let i = 0; i < 3; i++) {
    doc.text(`Year ${i + 1}`, xs[i] - 15, chartY + chartH + 4, {
      width: 30,
      align: "center",
    });
  }

  let legX = PAGE_MARGIN;
  const legY = chartY + chartH + 22;
  doc.font(FONT_NORMAL).fontSize(8);
  for (const sc of scenarios) {
    doc.rect(legX, legY, 10, 8).fill(sc.color);
    doc.fillColor("#000000").text(sc.name, legX + 14, legY, { width: 80 });
    legX += 100;
  }

  doc.fillColor("#000000").strokeColor("#000000").lineWidth(1);
  s.y = chartY + chartH + 40;
}

// ─── Income projections table ─────────────────────────────────────────────

function renderProjectionsTable(s: DocState) {
  const { doc, input } = s;
  const allYears = [input.baseYear, ...input.annualProjections];
  const colLabels = ["", "Base Year", "Year 1", "Year 2", "Year 3"];
  const colWidths = [140, 95, 95, 95, 95];
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, {
      width: colWidths[i],
      align: i > 0 ? "right" : "left",
    });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc
    .moveTo(startX, s.y - 2)
    .lineTo(startX + 520, s.y - 2)
    .lineWidth(0.3)
    .stroke("#cccccc");

  const rows: Array<{
    label: string;
    values: number[];
    bold?: boolean;
    pct?: boolean;
  }> = [
    { label: "Revenue", values: allYears.map((y) => y.revenue) },
    { label: "Cost of Goods Sold", values: allYears.map((y) => y.cogs) },
    {
      label: "Gross Profit",
      values: allYears.map((y) => y.grossProfit),
      bold: true,
    },
    {
      label: "Gross Margin",
      values: allYears.map((y) => y.grossMarginPct),
      pct: true,
    },
    {
      label: "Operating Expenses",
      values: allYears.map((y) => y.operatingExpenses),
    },
    { label: "EBITDA", values: allYears.map((y) => y.ebitda), bold: true },
    {
      label: "Net Income",
      values: allYears.map((y) => y.netIncome),
      bold: true,
    },
    {
      label: "Annual Loan Payment",
      values: allYears.map((y) => y.totalDebtService),
    },
    { label: "Coverage Ratio", values: allYears.map((y) => y.dscr) },
  ];

  for (const row of rows) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Financial Projections (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.text(row.label, x, s.y, { width: colWidths[0] });
    x += colWidths[0];

    for (let i = 0; i < row.values.length; i++) {
      const val = row.values[i];
      let display: string;
      if (row.pct) {
        display = fmtPct(val);
      } else if (row.label === "Coverage Ratio") {
        display = val >= 99 ? "—" : fmtDscr(val);
        if (val < SBA_DSCR_THRESHOLD && val < 99 && i > 0) {
          doc.fillColor(DSCR_RED);
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

// ─── Monthly cash flow (Year 1) ──────────────────────────────────────────

function renderMonthlyCashFlow(s: DocState) {
  const { doc, input } = s;
  const labelW = 100;
  const monthW = 36;
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(7).fillColor("#000000");
  let x = startX;
  doc.text("", x, s.y, { width: labelW });
  x += labelW;
  for (let m = 1; m <= 12; m++) {
    doc.text(`M${m}`, x, s.y, { width: monthW, align: "right" });
    x += monthW;
  }
  s.y += ROW_HEIGHT;
  doc
    .moveTo(startX, s.y - 2)
    .lineTo(startX + labelW + 12 * monthW, s.y - 2)
    .lineWidth(0.3)
    .stroke("#cccccc");

  const rows: Array<{
    label: string;
    getter: (m: MonthlyProjection) => number;
    bold?: boolean;
  }> = [
    { label: "Revenue", getter: (m) => m.revenue },
    { label: "Operating Costs", getter: (m) => m.operatingDisbursements },
    {
      label: "Net Operating CF",
      getter: (m) => m.netOperatingCF,
      bold: true,
    },
    { label: "Loan Payment", getter: (m) => m.debtService },
    { label: "Net Cash", getter: (m) => m.netCash },
    {
      label: "Cumulative Cash",
      getter: (m) => m.cumulativeCash,
      bold: true,
    },
  ];

  for (const row of rows) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Monthly Cash Flow (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(7);
    x = startX;
    doc.text(row.label, x, s.y, { width: labelW });
    x += labelW;

    for (const mp of input.monthlyProjections) {
      const val = row.getter(mp);
      if (row.label === "Cumulative Cash" && val < 0) {
        doc.fillColor(DSCR_RED);
      }
      doc.text(fmtCurrency(Math.round(val)), x, s.y, {
        width: monthW,
        align: "right",
      });
      doc.fillColor("#000000");
      x += monthW;
    }
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

// ─── Break-even ────────────────────────────────────────────────────────────

function renderBreakEven(s: DocState) {
  const { doc, input } = s;
  const be = input.breakEven;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  const lines: Array<[string, string]> = [
    [
      "Annual Fixed Costs",
      `$${fmtCurrency(Math.round(be.fixedCostsAnnual))}`,
    ],
    ["Contribution Margin", fmtPct(be.contributionMarginPct)],
    [
      "Break-Even Revenue (annual)",
      `$${fmtCurrency(Math.round(be.breakEvenRevenue))}`,
    ],
    [
      "Break-Even Revenue (monthly)",
      `$${fmtCurrency(Math.round(be.breakEvenRevenue / 12))}`,
    ],
    [
      "Projected Year 1 Revenue",
      `$${fmtCurrency(Math.round(be.projectedRevenueYear1))}`,
    ],
    ["Safety Margin", fmtPct(be.marginOfSafetyPct)],
  ];

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  for (const [label, value] of lines) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Break-Even Analysis (cont.)");
    doc.font(FONT_NORMAL).text(label, PAGE_MARGIN, s.y, {
      width: maxWidth - 150,
    });
    doc.font(FONT_BOLD).text(value, PAGE_MARGIN + maxWidth - 150, s.y, {
      width: 150,
      align: "right",
    });
    s.y += ROW_HEIGHT;
  }

  if (be.flagLowMargin) {
    s.y += 6;
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#b45309");
    doc.text(
      "Heads up: Your safety margin is under 10%. Any revenue shortfall could quickly tighten cash flow — build reserves early.",
      PAGE_MARGIN,
      s.y,
      { width: maxWidth, lineGap: 2 },
    );
    doc.fillColor("#000000");
    s.y = doc.y + 8;
  } else {
    s.y += 6;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
    doc.text(
      `In plain English: your business breaks even at $${fmtCurrency(Math.round(be.breakEvenRevenue / 12))} in monthly revenue. You're projecting well above that.`,
      PAGE_MARGIN,
      s.y,
      { width: maxWidth, lineGap: 2 },
    );
    doc.fillColor("#000000");
    s.y = doc.y + 8;
  }
}

// ─── Sensitivity scenarios ───────────────────────────────────────────────

function renderSensitivity(s: DocState) {
  const { doc, input } = s;
  const colWidths = [120, 75, 65, 65, 65, 80];
  const colLabels = [
    "Scenario",
    "Y1 Revenue",
    "Coverage Y1",
    "Coverage Y2",
    "Coverage Y3",
    "Passes Target",
  ];
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, {
      width: colWidths[i],
      align: i > 0 ? "right" : "left",
    });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc
    .moveTo(startX, s.y - 2)
    .lineTo(
      startX + colWidths.reduce((a, b) => a + b, 0),
      s.y - 2,
    )
    .lineWidth(0.3)
    .stroke("#cccccc");

  for (const scenario of input.sensitivityScenarios) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Risk Scenarios (cont.)");
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.text(scenario.label, x, s.y, { width: colWidths[0] });
    x += colWidths[0];

    doc.text(`$${fmtCurrency(Math.round(scenario.revenueYear1))}`, x, s.y, {
      width: colWidths[1],
      align: "right",
    });
    x += colWidths[1];

    const dscrs = [
      scenario.dscrYear1,
      scenario.dscrYear2,
      scenario.dscrYear3,
    ];
    for (const dscr of dscrs) {
      if (dscr < SBA_DSCR_THRESHOLD && dscr < 99) doc.fillColor(DSCR_RED);
      doc.text(dscr >= 99 ? "—" : fmtDscr(dscr), x, s.y, {
        width: 65,
        align: "right",
      });
      doc.fillColor("#000000");
      x += 65;
    }

    if (scenario.passesSBAThreshold) {
      doc.fillColor(PASS_GREEN);
      doc.text("✓ Pass", x, s.y, { width: colWidths[5], align: "right" });
    } else {
      doc.fillColor(DSCR_RED);
      doc.text("✗ Below", x, s.y, {
        width: colWidths[5],
        align: "right",
      });
    }
    doc.fillColor("#000000");
    s.y += ROW_HEIGHT;
  }
  s.y += 10;
}

// ─── God Tier — "Your Vision" page (borrower's own words) ─────────────────

function hasStorySubstance(story: BorrowerStory | null | undefined): boolean {
  if (!story) return false;
  const nonEmpty = (s: string | null) =>
    typeof s === "string" && s.trim().length > 0;
  return (
    nonEmpty(story.originStory) ||
    nonEmpty(story.competitiveInsight) ||
    nonEmpty(story.personalVision)
  );
}

function renderYourVisionPage(s: DocState) {
  const { doc, input } = s;
  const story = input.borrowerStory;
  if (!hasStorySubstance(story)) return;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  if (input.planThesis && input.planThesis.trim().length > 0) {
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_HEADER).fillColor(BRAND_NAVY);
    doc.text("The thesis of your plan", PAGE_MARGIN, s.y, { width: maxWidth });
    s.y += 20;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#000000");
    doc.text(input.planThesis.trim(), PAGE_MARGIN, s.y, {
      width: maxWidth,
      lineGap: 3,
    });
    s.y = doc.y + 18;
  }

  const renderQuoteBlock = (heading: string, body: string | null) => {
    if (!body || body.trim().length === 0) return;
    checkPageBreak(s, 80, "Your Vision (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(BRAND_NAVY);
    doc.text(heading, PAGE_MARGIN, s.y, { width: maxWidth });
    s.y += 16;

    // Left accent bar
    const blockTop = s.y;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#1f2937");
    doc.text(`"${body.trim()}"`, PAGE_MARGIN + 14, s.y, {
      width: maxWidth - 14,
      lineGap: 3,
    });
    const blockBottom = doc.y;
    doc
      .rect(PAGE_MARGIN, blockTop - 2, 3, blockBottom - blockTop + 4)
      .fill(BRAND_BLUE);
    doc.fillColor("#000000");
    s.y = blockBottom + 16;
  };

  if (story?.originStory) renderQuoteBlock("Why you started this", story.originStory);
  if (story?.competitiveInsight)
    renderQuoteBlock("Your edge", story.competitiveInsight);
  if (story?.idealCustomer)
    renderQuoteBlock("Who you serve", story.idealCustomer);
  if (story?.growthStrategy)
    renderQuoteBlock("How you'll grow", story.growthStrategy);
  if (story?.personalVision)
    renderQuoteBlock("What success looks like", story.personalVision);
}

// ─── God Tier — "Your First-Year Milestones" ──────────────────────────────

function milestoneColor(category: MilestoneCategory): string {
  switch (category) {
    case "funding":
      return "#7c3aed"; // purple
    case "operations":
      return BRAND_BLUE;
    case "hiring":
      return "#d97706"; // amber
    case "revenue":
      return PASS_GREEN;
    case "growth":
      return "#0891b2"; // cyan
  }
}

function renderMilestoneTimeline(s: DocState, milestones: Milestone[]) {
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const sorted = [...milestones].sort((a, b) => a.month - b.month);

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
  doc.text(
    "A month-by-month sequence of the specific milestones you're working toward — every line below has a measurable success signal so you'll know when you hit it.",
    PAGE_MARGIN,
    s.y,
    { width: maxWidth, lineGap: 2 },
  );
  doc.fillColor("#000000");
  s.y = doc.y + 14;

  for (const m of sorted) {
    checkPageBreak(s, 70, "Your First-Year Milestones (cont.)");
    const cardTop = s.y;
    const accentColor = milestoneColor(m.category);

    // Month pill
    const pillW = 58;
    doc.rect(PAGE_MARGIN, cardTop, pillW, 22).fill(accentColor);
    doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(9);
    doc.text(`Month ${m.month}`, PAGE_MARGIN, cardTop + 6, {
      width: pillW,
      align: "center",
    });

    // Title + category
    const titleX = PAGE_MARGIN + pillW + 10;
    const titleW = maxWidth - pillW - 10;
    doc.fillColor("#000000").font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text(m.title, titleX, cardTop, { width: titleW });
    const afterTitleY = doc.y;

    if (m.tiedToProceeds) {
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor(accentColor);
      doc.text(`${m.category.toUpperCase()} · funded by loan proceeds`, titleX, afterTitleY, {
        width: titleW,
      });
    } else {
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_GREY);
      doc.text(m.category.toUpperCase(), titleX, afterTitleY, { width: titleW });
    }

    let bodyY = doc.y + 4;
    if (m.description) {
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#1f2937");
      doc.text(m.description, titleX, bodyY, { width: titleW, lineGap: 2 });
      bodyY = doc.y + 4;
    }
    if (m.successMetric) {
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_NAVY);
      doc.text(`Success signal: `, titleX, bodyY, { continued: true });
      doc.font(FONT_NORMAL).fillColor("#1f2937");
      doc.text(m.successMetric, { width: titleW });
      bodyY = doc.y + 2;
    }

    doc.fillColor("#000000");
    s.y = bodyY + 10;
  }
}

// ─── God Tier — "Numbers to Watch" (KPI Dashboard) ────────────────────────

function renderKpiDashboard(s: DocState, kpis: KPITarget[]) {
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
  doc.text(
    "These are the numbers the best operators in your industry watch most closely. Track them, and you'll catch trouble before it shows up in revenue.",
    PAGE_MARGIN,
    s.y,
    { width: maxWidth, lineGap: 2 },
  );
  doc.fillColor("#000000");
  s.y = doc.y + 14;

  const cardW = (maxWidth - 14) / 2;
  const cardPad = 10;

  for (let i = 0; i < kpis.length; i += 2) {
    checkPageBreak(s, 120, "Numbers to Watch (cont.)");
    const row = [kpis[i], kpis[i + 1]].filter(Boolean) as KPITarget[];
    const rowTop = s.y;

    let maxRowY = rowTop;
    row.forEach((kpi, colIdx) => {
      const cardX = PAGE_MARGIN + colIdx * (cardW + 14);
      const textX = cardX + cardPad;
      const textW = cardW - cardPad * 2;
      const cardTop = rowTop;
      let innerY = cardTop + cardPad;

      doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(BRAND_NAVY);
      doc.text(kpi.name, textX, innerY, { width: textW });
      innerY = doc.y + 4;

      doc.font(FONT_BOLD).fontSize(12).fillColor(BRAND_BLUE);
      doc.text(kpi.targetValue, textX, innerY, { width: textW });
      innerY = doc.y + 2;

      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_GREY);
      doc.text(
        `${kpi.frequency.toUpperCase()} · Watch below ${kpi.warningThreshold}`,
        textX,
        innerY,
        { width: textW },
      );
      innerY = doc.y + 6;

      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor("#1f2937");
      doc.text(kpi.relevance, textX, innerY, { width: textW, lineGap: 2 });
      innerY = doc.y + cardPad;

      // Card border
      doc
        .rect(cardX, cardTop, cardW, innerY - cardTop)
        .lineWidth(0.75)
        .stroke(BRAND_GREY);

      if (innerY > maxRowY) maxRowY = innerY;
    });

    doc.fillColor("#000000");
    s.y = maxRowY + 12;
  }
}

// ─── God Tier — "Your Safety Net" (Risk Contingency Matrix) ──────────────

function severityColor(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "low":
      return PASS_GREEN;
    case "medium":
      return "#d97706";
    case "high":
      return DSCR_RED;
  }
}

function renderRiskContingencyMatrix(s: DocState, risks: RiskContingency[]) {
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
  doc.text(
    "If any of these triggers fire, you already have a plan. Each action below is specific and dollar-denominated — pick up and execute.",
    PAGE_MARGIN,
    s.y,
    { width: maxWidth, lineGap: 2 },
  );
  doc.fillColor("#000000");
  s.y = doc.y + 14;

  for (const r of risks) {
    checkPageBreak(s, 120, "Your Safety Net (cont.)");
    const cardTop = s.y;
    const color = severityColor(r.severity);

    // Severity pill
    const pillW = 56;
    doc.rect(PAGE_MARGIN, cardTop, pillW, 22).fill(color);
    doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(9);
    doc.text(r.severity.toUpperCase(), PAGE_MARGIN, cardTop + 6, {
      width: pillW,
      align: "center",
    });

    const textX = PAGE_MARGIN + pillW + 10;
    const textW = maxWidth - pillW - 10;

    doc.fillColor("#000000").font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text(r.risk, textX, cardTop, { width: textW });
    let innerY = doc.y + 4;

    if (r.trigger) {
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_NAVY);
      doc.text("Trigger: ", textX, innerY, { continued: true });
      doc.font(FONT_NORMAL).fillColor("#1f2937");
      doc.text(r.trigger, { width: textW });
      innerY = doc.y + 2;
    }
    if (r.impact) {
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_NAVY);
      doc.text("Impact: ", textX, innerY, { continued: true });
      doc.font(FONT_NORMAL).fillColor("#1f2937");
      doc.text(r.impact, { width: textW });
      innerY = doc.y + 6;
    }

    doc.font(FONT_BOLD).fontSize(FONT_SIZE_SMALL).fillColor(BRAND_NAVY);
    doc.text("Your response:", textX, innerY, { width: textW });
    innerY = doc.y + 2;

    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_SMALL).fillColor("#1f2937");
    r.actions.forEach((action, idx) => {
      doc.text(`${idx + 1}. ${action}`, textX + 8, innerY, {
        width: textW - 8,
        lineGap: 2,
      });
      innerY = doc.y + 2;
    });

    doc.fillColor("#000000");
    s.y = innerY + 12;
  }
}

// ─── Main render function ─────────────────────────────────────────────────

export function renderBorrowerProjectionPDF(
  input: BorrowerPDFInput,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const s: DocState = { doc, y: 0, pageNum: 1, input };

    // === Page 1: Cover ===
    renderCoverPage(s);

    // === Page 1.5 (God Tier): Your Vision — when story is present ===
    if (hasStorySubstance(input.borrowerStory) || (input.planThesis && input.planThesis.trim().length > 0)) {
      newPage(s, "Your Vision");
      renderYourVisionPage(s);
    }

    // === Page 2: Research & Industry Overview ===
    newPage(s, "Industry & Market Overview");
    if (input.researchBriefing && input.researchBriefing.trim()) {
      renderNarrativeBody(
        s,
        input.researchBriefing,
        "Industry & Market Overview (cont.)",
      );
    } else {
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
      doc.text(
        "Your industry research will appear here once Buddy completes the market analysis.",
        PAGE_MARGIN,
        s.y,
        { width: doc.page.width - PAGE_MARGIN * 2 },
      );
      doc.fillColor("#000000");
      s.y += ROW_HEIGHT;
    }

    // === Page 3: 3-Year Financial Projections ===
    newPage(s, "3-Year Financial Projections");
    renderProjectionsTable(s);
    checkPageBreak(s, 220, "3-Year Financial Projections (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
    doc.text("Revenue by Year", PAGE_MARGIN, s.y);
    s.y += 16;
    renderRevenueChart(s);

    // === Page 4: Monthly Cash Flow ===
    newPage(s, "Monthly Cash Flow — Year 1");
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
    doc.text(
      "This is how your cash flow is projected to look month-by-month in your first year. Watch the Cumulative Cash row — as long as it stays positive, you've got breathing room.",
      PAGE_MARGIN,
      s.y,
      { width: doc.page.width - PAGE_MARGIN * 2, lineGap: 2 },
    );
    doc.fillColor("#000000");
    s.y = doc.y + 14;
    renderMonthlyCashFlow(s);

    // === Page 5: Break-Even & Risk Scenarios ===
    newPage(s, "Break-Even & Risk Analysis");
    renderBreakEven(s);
    s.y += 10;
    checkPageBreak(s, 220, "Break-Even & Risk Analysis (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
    doc.text("Risk Scenarios", PAGE_MARGIN, s.y);
    s.y += 16;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
    doc.text(
      "What happens if things go better — or worse — than expected? A coverage ratio of 1.25x or higher means your business can comfortably handle its loan payments.",
      PAGE_MARGIN,
      s.y,
      { width: doc.page.width - PAGE_MARGIN * 2, lineGap: 2 },
    );
    doc.fillColor("#000000");
    s.y = doc.y + 14;
    renderSensitivity(s);
    checkPageBreak(s, 200, "Risk Scenarios (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
    doc.text("Coverage Ratio Across Scenarios", PAGE_MARGIN, s.y);
    s.y += 16;
    renderDSCRChart(s);

    // === Page 6: Your Business Roadmap ===
    newPage(s, "Your Business Roadmap");
    if (input.actionableRoadmap && input.actionableRoadmap.trim()) {
      renderNarrativeBody(
        s,
        input.actionableRoadmap,
        "Your Business Roadmap (cont.)",
      );
    } else {
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor(BRAND_GREY);
      doc.text(
        "Your personalized roadmap will appear here.",
        PAGE_MARGIN,
        s.y,
        { width: doc.page.width - PAGE_MARGIN * 2 },
      );
      doc.fillColor("#000000");
      s.y += ROW_HEIGHT;
    }

    // === God Tier — Your First-Year Milestones ===
    if (input.milestoneTimeline && input.milestoneTimeline.length > 0) {
      newPage(s, "Your First-Year Milestones");
      renderMilestoneTimeline(s, input.milestoneTimeline);
    }

    // === God Tier — Numbers to Watch ===
    if (input.kpiDashboard && input.kpiDashboard.length > 0) {
      newPage(s, "Numbers to Watch");
      renderKpiDashboard(s, input.kpiDashboard);
    }

    // === God Tier — Your Safety Net ===
    if (input.riskContingencyMatrix && input.riskContingencyMatrix.length > 0) {
      newPage(s, "Your Safety Net");
      renderRiskContingencyMatrix(s, input.riskContingencyMatrix);
    }

    drawPageFooter(s);
    doc.end();
  });
}
