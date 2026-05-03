import "server-only";

import PDFDocument from "pdfkit";
import type {
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  RevenueStreamProjection,
  SensitivityScenario,
  UseOfProceedsLine,
  ManagementMember,
  BalanceSheetYear,
  SourcesAndUsesResult,
  GlobalCashFlowResult,
} from "./sbaReadinessTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_NORMAL = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
// Phase 3 — premium typography: slightly larger body & section type for
// better readability while keeping the existing page layout intact.
const FONT_SIZE_BODY = 10;
const FONT_SIZE_HEADER = 11;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SECTION = 14;
const FONT_SIZE_SMALL = 7;
const PAGE_MARGIN = 40;
const HEADER_HEIGHT = 50;
const FOOTER_HEIGHT = 40;
const ROW_HEIGHT = 16;

const BRAND_NAVY = "#0f1e3c";
const BRAND_GREY = "#6b7280";
const SERIES_GREY = "#94a3b8";
const SERIES_NAVY = "#1e3a8a";
const SERIES_BLUE = "#2563eb";
const SERIES_AMBER = "#d97706";
const DSCR_RED = "#cc0000";
const PASS_GREEN = "#15803d";

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
// Types
// ---------------------------------------------------------------------------

interface RenderInput {
  dealName: string;
  loanType: string;
  loanAmount: number;
  baseYear: AnnualProjectionYear;
  annualProjections: AnnualProjectionYear[];
  monthlyProjections: MonthlyProjection[];
  /**
   * Per-stream revenue projections. When present and length ≥ 2, the
   * Financial Projections section adds a "Revenue Streams" subsection
   * with a description per stream and a stream × year breakdown table.
   * Single-stream (or absent) deals get the existing total-only view.
   */
  revenueStreamProjections?: RevenueStreamProjection[];
  breakEven: BreakEvenResult;
  sensitivityScenarios: SensitivityScenario[];
  useOfProceeds: UseOfProceedsLine[];
  businessOverviewNarrative: string;
  sensitivityNarrative: string;
  managementTeam: ManagementMember[];
  // Phase BPG additions — all optional so callers can opt in.
  executiveSummary?: string;
  industryAnalysis?: string;
  marketingStrategy?: string;
  operationsPlan?: string;
  swotStrengths?: string;
  swotWeaknesses?: string;
  swotOpportunities?: string;
  swotThreats?: string;
  franchiseSection?: string;
  sourcesAndUses?: SourcesAndUsesResult;
  balanceSheetProjections?: BalanceSheetYear[];
  globalCashFlow?: GlobalCashFlowResult;
  /** Sprint 3: when true, stamps a cosmetic preview watermark on every page. */
  previewWatermark?: boolean;
}

type DocState = {
  doc: PDFKit.PDFDocument;
  y: number;
  pageNum: number;
  input: RenderInput;
};

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

function drawPageHeader(s: DocState, sectionTitle: string) {
  const { doc, input } = s;
  const rightEdge = doc.page.width - PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_TITLE);
  doc.text("Business Plan & Financial Projections", PAGE_MARGIN, PAGE_MARGIN, {
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

// ─── Phase 3 — Insight callout box ──────────────────────────────────────
// Blue-tinted box with a left accent bar. Used before each major financial
// table so the reader gets a one-sentence takeaway before the numbers.
function renderInsightCallout(s: DocState, text: string, sectionTitle = "") {
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const boxH = 50;
  checkPageBreak(s, boxH + 10, sectionTitle);

  doc.rect(PAGE_MARGIN, s.y, maxWidth, boxH).fill("#eff6ff");
  doc.rect(PAGE_MARGIN, s.y, 4, boxH).fill("#2563eb");

  doc.fillColor("#1e40af").font(FONT_BOLD).fontSize(8);
  doc.text("KEY INSIGHT", PAGE_MARGIN + 14, s.y + 8, { width: maxWidth - 24 });
  doc.fillColor("#1e3a5f").font(FONT_NORMAL).fontSize(9);
  doc.text(text, PAGE_MARGIN + 14, s.y + 22, {
    width: maxWidth - 24,
    lineGap: 1,
  });
  doc.fillColor("#000000");
  s.y += boxH + 8;
}

// ─── Phase 3 — Key metrics dashboard ────────────────────────────────────
// 4 metric tiles in a row. Green top-stripe + green-tinted bg when the
// metric passes its SBA threshold, red otherwise. Rendered on the
// Executive Summary page, after the narrative text.
function renderKeyMetricsDashboard(s: DocState) {
  const { doc, input } = s;
  const boxW = (doc.page.width - PAGE_MARGIN * 2 - 30) / 4;
  const boxH = 70;
  checkPageBreak(s, boxH + 20, "Key Metrics");

  const y1 = input.annualProjections[0];
  const dscrY1 = y1?.dscr ?? 0;
  const breakEven = input.breakEven;
  const su = input.sourcesAndUses;
  const gcf = input.globalCashFlow;

  const metrics: Array<{
    label: string;
    value: string;
    sub: string;
    pass: boolean;
  }> = [
    {
      label: "DSCR Year 1",
      value: dscrY1 >= 99 ? "—" : fmtDscr(dscrY1),
      sub: "SBA Min: 1.25x",
      pass: dscrY1 >= SBA_DSCR_THRESHOLD,
    },
    {
      label: "Break-Even Safety",
      value: fmtPct(breakEven.marginOfSafetyPct),
      sub: breakEven.flagLowMargin ? "Below 10%" : "Adequate cushion",
      pass: !breakEven.flagLowMargin,
    },
    {
      label: "Equity Injection",
      value: su ? fmtPct(su.equityInjection.actualPct) : "N/A",
      sub: su ? `Min: ${fmtPct(su.equityInjection.minimumPct)}` : "",
      pass: su?.equityInjection.passes ?? true,
    },
    {
      label: "Global DSCR",
      value: gcf ? fmtDscr(gcf.globalDSCR) : "N/A",
      sub: "Business + Personal",
      pass: gcf ? gcf.globalDSCR >= SBA_DSCR_THRESHOLD : true,
    },
  ];

  for (let i = 0; i < metrics.length; i++) {
    const x = PAGE_MARGIN + i * (boxW + 10);
    const m = metrics[i];
    const borderColor = m.pass ? "#16a34a" : "#dc2626";
    const bgColor = m.pass ? "#f0fdf4" : "#fef2f2";

    doc.rect(x, s.y, boxW, boxH).fill(bgColor);
    doc.rect(x, s.y, boxW, 3).fill(borderColor);

    doc.fillColor("#374151").font(FONT_NORMAL).fontSize(8);
    doc.text(m.label, x + 8, s.y + 10, { width: boxW - 16 });

    doc.fillColor(borderColor).font(FONT_BOLD).fontSize(16);
    doc.text(m.value, x + 8, s.y + 24, { width: boxW - 16 });

    doc.fillColor("#6b7280").font(FONT_NORMAL).fontSize(7);
    doc.text(m.sub, x + 8, s.y + 48, { width: boxW - 16 });
  }

  doc.fillColor("#000000");
  s.y += boxH + 14;
}

function renderNarrativeBody(s: DocState, text: string, sectionTitle: string) {
  if (!text) return;
  const { doc } = s;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  // Simple paragraph renderer with page breaks
  const paragraphs = text.split(/\n\n+/);
  for (const p of paragraphs) {
    checkPageBreak(s, 40, sectionTitle);
    doc.text(p, PAGE_MARGIN, s.y, { width: maxWidth, lineGap: 2 });
    s.y = doc.y + 10;
  }
}

// ---------------------------------------------------------------------------
// Phase BPG — New page renderers
// ---------------------------------------------------------------------------

/** Cover page — branded header bar, title, borrower, loan, date, confidentiality. */
function renderCoverPage(s: DocState) {
  const { doc, input } = s;
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // Navy top bar
  doc.rect(0, 0, pageW, 90).fill(BRAND_NAVY);

  doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(22);
  doc.text("Buddy", PAGE_MARGIN, 32, { width: pageW - PAGE_MARGIN * 2 });
  doc.font(FONT_NORMAL).fontSize(11);
  doc.text("Institutional Underwriting", PAGE_MARGIN, 60);

  // Title block, centered vertically
  const titleY = pageH / 3;
  doc.fillColor(BRAND_NAVY).font(FONT_BOLD).fontSize(28);
  doc.text("Business Plan &", PAGE_MARGIN, titleY, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });
  doc.text("Financial Projections", PAGE_MARGIN, titleY + 34, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Borrower
  doc.fillColor("#000000").font(FONT_BOLD).fontSize(18);
  doc.text(input.dealName, PAGE_MARGIN, titleY + 100, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Loan type + amount
  doc.font(FONT_NORMAL).fontSize(13).fillColor(BRAND_GREY);
  doc.text(
    `${input.loanType.replace(/_/g, " ").toUpperCase()} — $${input.loanAmount.toLocaleString()}`,
    PAGE_MARGIN,
    titleY + 130,
    { width: pageW - PAGE_MARGIN * 2, align: "center" },
  );

  // Date
  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  doc.text(dateStr, PAGE_MARGIN, titleY + 150, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });

  // Confidentiality block near bottom
  const confY = pageH - 160;
  doc.fillColor("#000000").font(FONT_BOLD).fontSize(10);
  doc.text("CONFIDENTIAL", PAGE_MARGIN, confY, {
    width: pageW - PAGE_MARGIN * 2,
    align: "center",
  });
  doc.font(FONT_NORMAL).fontSize(8).fillColor(BRAND_GREY);
  doc.text(
    "This business plan contains confidential and proprietary information of the borrower. " +
      "Recipients agree not to disclose its contents to any third party without written permission.",
    PAGE_MARGIN,
    confY + 16,
    { width: pageW - PAGE_MARGIN * 2, align: "center" },
  );

  doc.fillColor("#000000");
  s.pageNum = 1;
  s.y = pageH;
}

/** Table of contents — 14 sections with dot leaders and estimated page numbers. */
function renderTableOfContents(
  s: DocState,
  entries: Array<{ label: string; page: number }>,
) {
  const { doc } = s;
  newPage(s, "Table of Contents");
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const pageColWidth = 30;
  const labelColWidth = maxWidth - pageColWidth - 4;

  for (const entry of entries) {
    checkPageBreak(s, ROW_HEIGHT + 2, "Table of Contents (cont.)");
    const rowY = s.y;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text(entry.label, PAGE_MARGIN, rowY, {
      width: labelColWidth,
    });
    doc.text(String(entry.page), PAGE_MARGIN + labelColWidth + 4, rowY, {
      width: pageColWidth,
      align: "right",
    });
    // Dot leader
    doc
      .strokeColor(BRAND_GREY)
      .dash(1, { space: 3 })
      .moveTo(PAGE_MARGIN + 180, rowY + 10)
      .lineTo(PAGE_MARGIN + labelColWidth, rowY + 10)
      .stroke()
      .undash()
      .strokeColor("#000000");
    s.y = rowY + ROW_HEIGHT + 2;
  }
}

/**
 * Pricing-model labels for the per-stream description. Mirrors the union
 * in RevenueStream.pricingModel so the renderer never shows raw enum
 * values to the reader.
 */
const PRICING_MODEL_LABEL: Record<
  RevenueStreamProjection["pricingModel"],
  string
> = {
  flat: "Flat / Per-Transaction",
  per_unit: "Per Unit",
  subscription: "Subscription / Recurring",
  pct_revenue: "% of Revenue",
};

/**
 * Per-stream revenue subsection. Skipped silently when there is fewer
 * than 2 streams (single-stream deals get the existing total chart and
 * nothing else changes for them). Two parts:
 *
 *   1. A short descriptive line per stream (name, pricing model, base
 *      annual revenue, Y1 growth) so the reader sees what each stream
 *      actually IS — required by the institutional spec for multi-stream
 *      borrowers (e.g. auto sales / service / tire).
 *   2. A streams × years breakdown table with a TOTAL row showing the
 *      consolidated revenue line.
 */
function renderRevenueStreamsBreakdown(s: DocState): void {
  const { doc, input } = s;
  const projections = input.revenueStreamProjections ?? [];
  if (projections.length < 2) return;

  const sectionTitle = "7. Financial Projections (cont.)";

  // ── Header
  checkPageBreak(s, 28, sectionTitle);
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  doc.text("Revenue Streams", PAGE_MARGIN, s.y);
  s.y += 14;

  // ── Per-stream descriptions
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  for (const p of projections) {
    checkPageBreak(s, ROW_HEIGHT + 4, sectionTitle);
    const label = PRICING_MODEL_LABEL[p.pricingModel] ?? p.pricingModel;
    const desc = `${p.name}: ${label} model. Base year revenue $${fmtCurrency(
      Math.round(p.baseAnnualRevenue),
    )}; ${fmtPct(p.growthRateYear1)} Year 1 growth.`;
    doc.fillColor("#000000").text(desc, PAGE_MARGIN, s.y, {
      width: doc.page.width - PAGE_MARGIN * 2,
      lineGap: 1,
    });
    s.y = doc.y + 2;
  }
  s.y += 8;

  // ── Streams × Year table
  const colLabels = ["Stream", "Base Year", "Year 1", "Year 2", "Year 3"];
  const colWidths = [180, 85, 85, 85, 85];
  const startX = PAGE_MARGIN;
  const tableW = colWidths.reduce((a, b) => a + b, 0);

  checkPageBreak(s, ROW_HEIGHT * (projections.length + 3), sectionTitle);

  // Header row
  doc.rect(startX, s.y - 2, tableW, ROW_HEIGHT + 2).fill(BRAND_NAVY);
  doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x + 4, s.y + 2, {
      width: colWidths[i] - 8,
      align: i === 0 ? "left" : "right",
    });
    x += colWidths[i];
  }
  doc.fillColor("#000000");
  s.y += ROW_HEIGHT;

  // Per-stream rows
  let totalBase = 0;
  let totalY1 = 0;
  let totalY2 = 0;
  let totalY3 = 0;
  for (let i = 0; i < projections.length; i++) {
    const p = projections[i];
    totalBase += p.baseAnnualRevenue;
    totalY1 += p.revenueYear1;
    totalY2 += p.revenueYear2;
    totalY3 += p.revenueYear3;

    const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    doc.rect(startX, s.y - 1, tableW, ROW_HEIGHT + 1).fill(bg);

    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#000000");
    x = startX;
    doc.text(p.name, x + 4, s.y + 2, { width: colWidths[0] - 8 });
    x += colWidths[0];
    const cells = [
      p.baseAnnualRevenue,
      p.revenueYear1,
      p.revenueYear2,
      p.revenueYear3,
    ];
    for (let c = 0; c < cells.length; c++) {
      doc.text(`$${fmtCurrency(Math.round(cells[c]))}`, x + 4, s.y + 2, {
        width: colWidths[c + 1] - 8,
        align: "right",
      });
      x += colWidths[c + 1];
    }
    s.y += ROW_HEIGHT;
  }

  // Consolidated total row — always shown so the reader sees the
  // streams roll up to the same revenue line that drives DSCR / pricing.
  doc.rect(startX, s.y - 1, tableW, ROW_HEIGHT + 1).fill("#eff6ff");
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  x = startX;
  doc.text("Total Revenue", x + 4, s.y + 2, { width: colWidths[0] - 8 });
  x += colWidths[0];
  const totals = [totalBase, totalY1, totalY2, totalY3];
  for (let c = 0; c < totals.length; c++) {
    doc.text(`$${fmtCurrency(Math.round(totals[c]))}`, x + 4, s.y + 2, {
      width: colWidths[c + 1] - 8,
      align: "right",
    });
    x += colWidths[c + 1];
  }
  s.y += ROW_HEIGHT + 8;
  doc.font(FONT_NORMAL);
}

/** Revenue bar chart — gray bars for actual (year 0), navy for projected (years 1-3). */
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

  // Axis
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
    // Value label above bar
    doc
      .fillColor("#000000")
      .font(FONT_BOLD)
      .fontSize(8)
      .text(
        `$${fmtCurrency(Math.round(yr.revenue))}`,
        barX,
        topY - 12,
        { width: barW, align: "center" },
      );
    // X-axis label
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

/** DSCR line chart with 1.25x threshold line. */
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

  // Axes
  doc
    .strokeColor(BRAND_GREY)
    .moveTo(plotX, chartY)
    .lineTo(plotX, chartY + chartH)
    .lineTo(plotX + plotW, chartY + chartH)
    .stroke();

  // 1.25x threshold red line
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
    .text("SBA 1.25x min", plotX + plotW - 80, thresholdY - 10, {
      width: 80,
      align: "right",
    });

  // Series
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
    // Dots + labels
    for (let i = 0; i < sc.dscrs.length; i++) {
      const yy =
        chartY + chartH - ((sc.dscrs[i] - dMin) / (dMax - dMin)) * chartH;
      doc.fillColor(sc.color).circle(xs[i], yy, 3).fill();
    }
  }

  // X-axis labels
  doc.fillColor(BRAND_GREY).font(FONT_NORMAL).fontSize(8);
  for (let i = 0; i < 3; i++) {
    doc.text(`Year ${i + 1}`, xs[i] - 15, chartY + chartH + 4, {
      width: 30,
      align: "center",
    });
  }

  // Legend
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

/** Section 13 — Sources & Uses table with equity injection pass/fail callout. */
function renderSection13_SourcesAndUses(s: DocState) {
  const { doc, input } = s;
  const su = input.sourcesAndUses;
  if (!su) {
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text("Sources & Uses data not available.", PAGE_MARGIN, s.y);
    s.y += 20;
    return;
  }
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const colW = maxWidth / 2 - 10;

  // Two-column header
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  doc.text("Sources", PAGE_MARGIN, s.y, { width: colW });
  doc.text("Uses", PAGE_MARGIN + colW + 20, s.y, { width: colW });
  s.y += ROW_HEIGHT;

  doc
    .moveTo(PAGE_MARGIN, s.y - 2)
    .lineTo(PAGE_MARGIN + maxWidth, s.y - 2)
    .lineWidth(0.3)
    .stroke(BRAND_GREY);

  const leftStartY = s.y;
  const rightStartY = s.y;

  // Sources column
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  let ySrc = leftStartY;
  for (const src of su.sources) {
    doc.text(src.label, PAGE_MARGIN, ySrc, { width: colW - 90 });
    doc.text(
      `$${fmtCurrency(Math.round(src.amount))}`,
      PAGE_MARGIN + colW - 90,
      ySrc,
      { width: 90, align: "right" },
    );
    ySrc += ROW_HEIGHT;
  }
  ySrc += 4;
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  doc.text("Total Sources", PAGE_MARGIN, ySrc, { width: colW - 90 });
  doc.text(
    `$${fmtCurrency(Math.round(su.totalSources))}`,
    PAGE_MARGIN + colW - 90,
    ySrc,
    { width: 90, align: "right" },
  );

  // Uses column
  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  let yUse = rightStartY;
  const useX = PAGE_MARGIN + colW + 20;
  for (const use of su.uses) {
    doc.text(use.label, useX, yUse, { width: colW - 90 });
    doc.text(
      `$${fmtCurrency(Math.round(use.amount))}`,
      useX + colW - 90,
      yUse,
      { width: 90, align: "right" },
    );
    yUse += ROW_HEIGHT;
  }
  yUse += 4;
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  doc.text("Total Uses", useX, yUse, { width: colW - 90 });
  doc.text(
    `$${fmtCurrency(Math.round(su.totalUses))}`,
    useX + colW - 90,
    yUse,
    { width: 90, align: "right" },
  );

  s.y = Math.max(ySrc, yUse) + 24;

  // Equity injection callout
  const ei = su.equityInjection;
  const boxColor = ei.passes ? PASS_GREEN : DSCR_RED;
  const boxH = 56;
  checkPageBreak(s, boxH + 10, "Section 13: Sources & Uses (cont.)");
  doc.rect(PAGE_MARGIN, s.y, maxWidth, boxH).stroke(boxColor);

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor(boxColor);
  doc.text(
    ei.passes ? "Equity Injection — Meets SBA Minimum" : "Equity Injection — Below SBA Minimum",
    PAGE_MARGIN + 10,
    s.y + 8,
    { width: maxWidth - 20 },
  );

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  const line = `Required minimum: ${fmtPct(ei.minimumPct)} — Actual: ${fmtPct(ei.actualPct)} ($${fmtCurrency(Math.round(ei.actualAmount))})${ei.shortfallAmount > 0 ? ` — Shortfall: $${fmtCurrency(ei.shortfallAmount)}` : ""}`;
  doc.text(line, PAGE_MARGIN + 10, s.y + 28, { width: maxWidth - 20 });

  s.y += boxH + 14;
}

function renderBalanceSheetTable(s: DocState) {
  const { doc, input } = s;
  const bs = input.balanceSheetProjections ?? [];
  if (bs.length === 0) {
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text("Balance sheet projections not available.", PAGE_MARGIN, s.y);
    s.y += 20;
    return;
  }

  const colLabels = ["", ...bs.map((b) => (b.label === "Actual" ? "Base Year" : `Year ${b.year}`))];
  const colWidths = [140, ...bs.map(() => 90)];
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, { width: colWidths[i], align: i > 0 ? "right" : "left" });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc
    .moveTo(startX, s.y - 2)
    .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), s.y - 2)
    .lineWidth(0.3)
    .stroke("#cccccc");

  const rows: Array<{ label: string; get: (b: BalanceSheetYear) => number; bold?: boolean; ratio?: boolean }> = [
    { label: "Cash", get: (b) => b.cash },
    { label: "Accounts Receivable", get: (b) => b.accountsReceivable },
    { label: "Inventory", get: (b) => b.inventory },
    { label: "Total Current Assets", get: (b) => b.totalCurrentAssets, bold: true },
    { label: "Fixed Assets", get: (b) => b.fixedAssets },
    { label: "Total Assets", get: (b) => b.totalAssets, bold: true },
    { label: "Accounts Payable", get: (b) => b.accountsPayable },
    { label: "Short-Term Debt", get: (b) => b.shortTermDebt },
    { label: "Long-Term Debt", get: (b) => b.longTermDebt },
    { label: "Total Liabilities", get: (b) => b.totalLiabilities, bold: true },
    { label: "Total Equity", get: (b) => b.totalEquity, bold: true },
    { label: "Current Ratio", get: (b) => b.currentRatio, ratio: true },
    { label: "Debt to Equity", get: (b) => b.debtToEquity, ratio: true },
    { label: "Working Capital", get: (b) => b.workingCapital, bold: true },
  ];

  for (const row of rows) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Projected Balance Sheet (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.text(row.label, x, s.y, { width: colWidths[0] });
    x += colWidths[0];
    for (let i = 0; i < bs.length; i++) {
      const v = row.get(bs[i]);
      const display = row.ratio ? v.toFixed(2) : `$${fmtCurrency(Math.round(v))}`;
      doc.text(display, x, s.y, { width: colWidths[i + 1], align: "right" });
      x += colWidths[i + 1];
    }
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

function renderGlobalCashFlow(s: DocState) {
  const { doc, input } = s;
  const gcf = input.globalCashFlow;
  if (!gcf) {
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text("Global cash flow data not available.", PAGE_MARGIN, s.y);
    s.y += 20;
    return;
  }
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  const lines: Array<[string, string]> = [
    ["Business EBITDA", `$${fmtCurrency(Math.round(gcf.businessEbitda))}`],
    ["+ Total Net Personal Cash", `$${fmtCurrency(Math.round(gcf.totalNetPersonalCash))}`],
    ["= Global Cash Available", `$${fmtCurrency(Math.round(gcf.globalCashAvailable))}`],
    ["Business Debt Service", `$${fmtCurrency(Math.round(gcf.globalDebtService))}`],
    ["Global DSCR", fmtDscr(gcf.globalDSCR)],
    ["Meets SBA Minimum (1.25x)", gcf.meetsSbaThreshold ? "Yes" : "No"],
  ];

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  for (const [label, value] of lines) {
    checkPageBreak(s, ROW_HEIGHT + 4, "Global Cash Flow (cont.)");
    doc.text(label, PAGE_MARGIN, s.y, { width: maxWidth - 120 });
    doc.text(value, PAGE_MARGIN + maxWidth - 120, s.y, {
      width: 120,
      align: "right",
    });
    s.y += ROW_HEIGHT;
  }

  if (gcf.guarantorsWithNegativeCashFlow > 0) {
    s.y += 4;
    doc.fillColor("#b45309").font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text(
      `Warning: ${gcf.guarantorsWithNegativeCashFlow} guarantor(s) with negative personal cash flow.`,
      PAGE_MARGIN,
      s.y,
      { width: maxWidth },
    );
    doc.fillColor("#000000");
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

// ---------------------------------------------------------------------------
// Existing sections (retained, may be reordered)
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
  const tableW = colWidths.reduce((a, b) => a + b, 0);

  // Phase 3 — navy header row with white text
  doc.rect(startX, s.y - 2, tableW, ROW_HEIGHT + 2).fill("#0f1e3c");
  doc.fillColor("#ffffff").font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x + 4, s.y + 2, {
      width: colWidths[i] - 8,
      align: i > 0 ? "right" : "left",
    });
    x += colWidths[i];
  }
  doc.fillColor("#000000");
  s.y += ROW_HEIGHT;

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

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    checkPageBreak(s, ROW_HEIGHT + 4, "Financial Projections (cont.)");

    // Phase 3 — alternating row background; subtle light-blue for bold (subtotal) rows
    const bg = row.bold ? "#eff6ff" : rIdx % 2 === 0 ? "#f8fafc" : "#ffffff";
    doc.rect(startX, s.y - 1, tableW, ROW_HEIGHT + 1).fill(bg);

    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    x = startX;
    doc.fillColor("#000000");
    doc.text(row.label, x + 4, s.y + 2, { width: colWidths[0] - 8 });
    x += colWidths[0];

    for (let i = 0; i < row.values.length; i++) {
      const val = row.values[i];
      let display: string;
      let cellBg: string | null = null;
      if (row.pct) {
        display = fmtPct(val);
      } else if (row.label === "DSCR") {
        display = fmtDscr(val);
        if (i > 0 && val < 99) {
          if (val < SBA_DSCR_THRESHOLD) {
            cellBg = "#fef2f2";
            doc.fillColor(DSCR_RED);
          } else {
            cellBg = "#f0fdf4";
            doc.fillColor("#16a34a");
          }
        }
      } else {
        display = `$${fmtCurrency(val)}`;
      }
      if (cellBg) {
        doc.rect(x, s.y - 1, colWidths[i + 1], ROW_HEIGHT + 1).fill(cellBg);
        // re-assert font color since fill() resets state in some pdfkit builds
        if (row.label === "DSCR") {
          doc.fillColor(
            row.values[i] < SBA_DSCR_THRESHOLD ? DSCR_RED : "#16a34a",
          );
        }
      }
      doc.text(display, x + 4, s.y + 2, {
        width: colWidths[i + 1] - 8,
        align: "right",
      });
      doc.fillColor("#000000");
      x += colWidths[i + 1];
    }
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

function renderSection3_MonthlyCF(s: DocState) {
  const { doc, input } = s;
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
    checkPageBreak(s, ROW_HEIGHT + 4, "Monthly Cash Flow — Year 1 (cont.)");
    doc.font(row.bold ? FONT_BOLD : FONT_NORMAL).fontSize(7);
    x = startX;
    doc.text(row.label, x, s.y, { width: labelW });
    x += labelW;

    for (const mp of input.monthlyProjections) {
      const val = row.getter(mp);
      if (row.label === "Cumulative Cash" && val < 0) {
        doc.fillColor(DSCR_RED);
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
    checkPageBreak(s, ROW_HEIGHT + 4, "Break-Even Analysis (cont.)");
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

    for (const dscr of [scenario.dscrYear1, scenario.dscrYear2, scenario.dscrYear3]) {
      if (dscr < SBA_DSCR_THRESHOLD) doc.fillColor(DSCR_RED);
      doc.text(fmtDscr(dscr), x, s.y, { width: 65, align: "right" });
      doc.fillColor("#000000");
      x += 65;
    }

    if (scenario.passesSBAThreshold) {
      doc.fillColor(PASS_GREEN);
      doc.text("\u2713 Pass", x, s.y, { width: colWidths[5], align: "right" });
    } else {
      doc.fillColor(DSCR_RED);
      doc.text("\u2717 Below 1.25x", x, s.y, { width: colWidths[5], align: "right" });
    }
    doc.fillColor("#000000");
    s.y += ROW_HEIGHT;
  }

  s.y += 12;

  if (input.sensitivityNarrative) {
    const maxWidth = doc.page.width - PAGE_MARGIN * 2;
    checkPageBreak(s, 80, "Sensitivity Analysis (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text("Commentary", PAGE_MARGIN, s.y);
    s.y += 14;
    doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
    doc.text(input.sensitivityNarrative, PAGE_MARGIN, s.y, { width: maxWidth, lineGap: 2 });
    s.y = doc.y + 8;
  }
}

function renderUseOfProceeds(s: DocState) {
  const { doc, input } = s;
  const colWidths = [140, 220, 100, 60];
  const colLabels = ["Category", "Description", "Amount", "% of Total"];
  const startX = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
  let x = startX;
  for (let i = 0; i < colLabels.length; i++) {
    doc.text(colLabels[i], x, s.y, {
      width: colWidths[i],
      align: i >= 2 ? "right" : "left",
    });
    x += colWidths[i];
  }
  s.y += ROW_HEIGHT;
  doc.moveTo(startX, s.y - 2).lineTo(startX + 520, s.y - 2).lineWidth(0.3).stroke("#cccccc");

  doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
  for (const row of input.useOfProceeds) {
    checkPageBreak(s, ROW_HEIGHT + 2, "Use of Proceeds (cont.)");
    x = startX;
    doc.text(row.category, x, s.y, { width: colWidths[0] });
    x += colWidths[0];
    doc.text(row.description || "", x, s.y, { width: colWidths[1] });
    x += colWidths[1];
    doc.text(`$${fmtCurrency(Math.round(row.amount))}`, x, s.y, {
      width: colWidths[2],
      align: "right",
    });
    x += colWidths[2];
    doc.text(fmtPct(row.pctOfTotal), x, s.y, {
      width: colWidths[3],
      align: "right",
    });
    s.y += ROW_HEIGHT;
  }
  s.y += 8;
}

// ---------------------------------------------------------------------------
// Main render function — 14-page professional business plan
// ---------------------------------------------------------------------------

/**
 * Diagonal translucent "PREVIEW — UNLOCKS WHEN YOU PICK A LENDER" watermark.
 * Cosmetic only. Sprint 3: real PII protection lives in the data-layer
 * redactor before this function is ever called.
 */
function drawPreviewWatermark(doc: PDFKit.PDFDocument): void {
  doc.save();
  const { width, height } = doc.page;
  const cx = width / 2;
  const cy = height / 2;
  doc.translate(cx, cy).rotate(-30);
  doc.opacity(0.12);
  doc.font("Helvetica-Bold").fontSize(48).fillColor("#1f2937");
  doc.text("PREVIEW — UNLOCKS WHEN YOU PICK A LENDER", -width / 2, -24, {
    width,
    align: "center",
  });
  doc.opacity(1);
  doc.restore();
}

export function renderSBAPackagePDF(input: RenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margin: PAGE_MARGIN,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const s: DocState = { doc, y: 0, pageNum: 1, input };

    // === Page 1: Cover ===
    renderCoverPage(s);

    // === Page 2: Table of Contents ===
    // Estimated page numbers — content lays out on successive pages.
    const tocEntries: Array<{ label: string; page: number }> = [
      { label: "1. Executive Summary", page: 3 },
      { label: "2. Company Description", page: 4 },
      { label: "3. Industry Analysis", page: 5 },
      { label: "4. Products, Services & Marketing Strategy", page: 6 },
      { label: "5. Operations Plan & Management Team", page: 7 },
      { label: "6. SWOT Analysis", page: 8 },
      { label: "7. Financial Projections & Revenue Chart", page: 9 },
      { label: "8. Projected Balance Sheet", page: 10 },
      { label: "9. Monthly Cash Flow — Year 1", page: 11 },
      { label: "10. Break-Even Analysis", page: 12 },
      { label: "11. Sensitivity Analysis & DSCR Chart", page: 13 },
      { label: "12. Global Cash Flow", page: 14 },
      { label: "13. Sources & Uses of Funds", page: 15 },
      { label: "14. Use of Proceeds", page: 16 },
    ];
    if (input.franchiseSection) {
      tocEntries.push({ label: "Franchise Overview", page: 17 });
    }
    renderTableOfContents(s, tocEntries);

    // === Page 3: Executive Summary ===
    newPage(s, "1. Executive Summary");
    if (input.executiveSummary) {
      renderNarrativeBody(s, input.executiveSummary, "1. Executive Summary (cont.)");
    } else {
      s.doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
      s.doc.text("Executive summary not available.", PAGE_MARGIN, s.y);
      s.y += ROW_HEIGHT;
    }

    // Phase 3 — premium: key metrics dashboard on the Executive Summary
    // page. Four tiles (DSCR Y1, Break-Even Safety, Equity Injection,
    // Global DSCR) with SBA threshold pass/fail color coding.
    s.y += 6;
    renderKeyMetricsDashboard(s);

    // === Page 4: Company Description ===
    newPage(s, "2. Company Description");
    renderSection1_BusinessOverview(s);

    // === Page 5: Industry Analysis ===
    newPage(s, "3. Industry Analysis");
    if (input.industryAnalysis) {
      renderNarrativeBody(s, input.industryAnalysis, "3. Industry Analysis (cont.)");
    } else {
      s.doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
      s.doc.text("Industry analysis not available.", PAGE_MARGIN, s.y);
      s.y += ROW_HEIGHT;
    }

    // === Page 6: Products/Marketing ===
    newPage(s, "4. Products, Services & Marketing Strategy");
    if (input.marketingStrategy) {
      renderNarrativeBody(
        s,
        input.marketingStrategy,
        "4. Products, Services & Marketing Strategy (cont.)",
      );
    }

    // === Page 7: Operations & Team ===
    newPage(s, "5. Operations Plan & Management Team");
    if (input.operationsPlan) {
      renderNarrativeBody(
        s,
        input.operationsPlan,
        "5. Operations Plan & Management Team (cont.)",
      );
    }

    // === Page 8: SWOT ===
    newPage(s, "6. SWOT Analysis");
    const swotSections: Array<[string, string | undefined]> = [
      ["Strengths", input.swotStrengths],
      ["Weaknesses", input.swotWeaknesses],
      ["Opportunities", input.swotOpportunities],
      ["Threats", input.swotThreats],
    ];
    for (const [label, body] of swotSections) {
      doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
      doc.text(label, PAGE_MARGIN, s.y);
      s.y += ROW_HEIGHT;
      doc.font(FONT_NORMAL).fontSize(FONT_SIZE_BODY);
      if (body) {
        renderNarrativeBody(s, body, "6. SWOT Analysis (cont.)");
      } else {
        doc.text(`${label} not available.`, PAGE_MARGIN, s.y);
        s.y += ROW_HEIGHT;
      }
    }

    // === Page 9: Financial Projections + Revenue Chart ===
    newPage(s, "7. Financial Projections");
    {
      const y1 = input.annualProjections[0];
      const dscrY1 = y1?.dscr ?? 0;
      const insight =
        dscrY1 >= 1.5
          ? `${input.dealName} generates $${fmtCurrency(Math.round(y1?.ebitda ?? 0))} in Year 1 EBITDA against $${fmtCurrency(Math.round(y1?.totalDebtService ?? 0))} in annual debt service — a ${fmtDscr(dscrY1)} coverage ratio providing ${Math.round((dscrY1 - 1) * 100)}% cushion above the SBA 1.25x minimum.`
          : dscrY1 >= SBA_DSCR_THRESHOLD
            ? `${input.dealName} meets the SBA 1.25x DSCR threshold at ${fmtDscr(dscrY1)} in Year 1. Break-even margin of safety is ${fmtPct(input.breakEven.marginOfSafetyPct)}.`
            : `Year 1 projected DSCR of ${fmtDscr(dscrY1)} falls below the SBA 1.25x minimum. Assumption review is recommended before submission.`;
      renderInsightCallout(s, insight, "7. Financial Projections");
    }
    renderSection2_Projections(s);
    // Per-stream breakdown — only rendered when there are 2+ streams.
    // Single-stream deals fall through to the existing total chart with
    // no layout change.
    renderRevenueStreamsBreakdown(s);
    checkPageBreak(s, 220, "7. Financial Projections (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text("Revenue by Year", PAGE_MARGIN, s.y);
    s.y += 14;
    renderRevenueChart(s);

    // === Page 10: Projected Balance Sheet ===
    newPage(s, "8. Projected Balance Sheet");
    renderBalanceSheetTable(s);

    // === Page 11: Monthly Cash Flow ===
    newPage(s, "9. Monthly Cash Flow — Year 1");
    {
      const months = input.monthlyProjections ?? [];
      let tightestMonth = 0;
      let minCum = Number.POSITIVE_INFINITY;
      for (let i = 0; i < months.length; i++) {
        if (months[i].cumulativeCash < minCum) {
          minCum = months[i].cumulativeCash;
          tightestMonth = i + 1;
        }
      }
      if (months.length > 0) {
        const insight = `The tightest month for cash is Month ${tightestMonth} with a cumulative cash position of $${fmtCurrency(Math.round(minCum))}. Monitoring working capital during this window keeps operations funded.`;
        renderInsightCallout(s, insight, "9. Monthly Cash Flow — Year 1");
      }
    }
    renderSection3_MonthlyCF(s);

    // === Page 12: Break-Even ===
    newPage(s, "10. Break-Even Analysis");
    {
      const be = input.breakEven;
      const y1Rev = input.annualProjections[0]?.revenue ?? 0;
      const insight = `${input.dealName} needs $${fmtCurrency(Math.round(be.breakEvenRevenue))} in annual revenue to cover all costs. Projected Year 1 revenue of $${fmtCurrency(Math.round(y1Rev))} provides a ${fmtPct(be.marginOfSafetyPct)} safety cushion${be.flagLowMargin ? " — below the 10% threshold SBA underwriters typically want to see" : ""}.`;
      renderInsightCallout(s, insight, "10. Break-Even Analysis");
    }
    renderSection4_BreakEven(s);

    // === Page 13: Sensitivity + DSCR Chart ===
    newPage(s, "11. Sensitivity Analysis");
    renderSection5_Sensitivity(s);
    checkPageBreak(s, 200, "11. Sensitivity Analysis (cont.)");
    doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY);
    doc.text("DSCR Scenarios vs SBA Minimum", PAGE_MARGIN, s.y);
    s.y += 14;
    renderDSCRChart(s);

    // === Page 14: Global Cash Flow ===
    newPage(s, "12. Global Cash Flow");
    if (input.globalCashFlow) {
      const gcf = input.globalCashFlow;
      const insight = `Including personal cash flow, the combined coverage ratio is ${fmtDscr(gcf.globalDSCR)}. Business EBITDA of $${fmtCurrency(Math.round(gcf.businessEbitda))} plus net personal cash of $${fmtCurrency(Math.round(gcf.totalNetPersonalCash))} covers $${fmtCurrency(Math.round(gcf.globalDebtService))} of total debt service.`;
      renderInsightCallout(s, insight, "12. Global Cash Flow");
    }
    renderGlobalCashFlow(s);

    // === Page 15: Sources & Uses ===
    newPage(s, "13. Sources & Uses of Funds");
    if (input.sourcesAndUses) {
      const ei = input.sourcesAndUses.equityInjection;
      const insight = ei.passes
        ? `Equity injection of ${fmtPct(ei.actualPct)} ($${fmtCurrency(Math.round(ei.actualAmount))}) exceeds the SBA minimum of ${fmtPct(ei.minimumPct)} — a meaningful commitment of borrower capital.`
        : `Equity injection of ${fmtPct(ei.actualPct)} falls short of the SBA minimum ${fmtPct(ei.minimumPct)} by $${fmtCurrency(ei.shortfallAmount)}. Additional equity or alternate sources are needed.`;
      renderInsightCallout(s, insight, "13. Sources & Uses of Funds");
    }
    renderSection13_SourcesAndUses(s);

    // === Page 16: Use of Proceeds ===
    newPage(s, "14. Use of Proceeds");
    renderUseOfProceeds(s);

    // === Optional: Franchise section ===
    if (input.franchiseSection) {
      newPage(s, "Franchise Overview");
      renderNarrativeBody(s, input.franchiseSection, "Franchise Overview (cont.)");
    }

    // Final footer on last page
    drawPageFooter(s);

    // Sprint 3: preview watermark is applied to every buffered page.
    if (input.previewWatermark) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawPreviewWatermark(doc);
      }
    }

    doc.end();
  });
}
