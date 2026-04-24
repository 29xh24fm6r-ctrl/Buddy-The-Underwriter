import "server-only";

/**
 * POST /api/deals/[dealId]/credit-memo/canonical/pdf
 *
 * Generates a PDF of the canonical credit memo using PDFKit (pure Node.js).
 * Replaces the previous Playwright/Chromium approach which fails on Vercel serverless.
 */

import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import type { CanonicalCreditMemoV1, DebtCoverageRow, IncomeStatementRow, BalanceSheetRow } from "@/lib/creditMemo/canonical/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt$(val: number | null): string {
  if (val === null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${val.toFixed(0)}`;
}

function fmtPct(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(2)}%`;
}

function fmtRatio(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(2)}x`;
}

function pending(val: string | null | undefined): string {
  return val || "Pending";
}

function pendingNum(val: number | null, fmt: (v: number | null) => string): string {
  return val === null ? "Pending" : fmt(val);
}

// ── PDF builder ───────────────────────────────────────────────────────────────

const COLORS = {
  black:      "#111418",
  gray:       "#4B5563",
  lightGray:  "#9CA3AF",
  lineGray:   "#E5E7EB",
  headerBg:   "#1E293B",
  sectionBg:  "#F8FAFC",
  accent:     "#2563EB",
  green:      "#16A34A",
  red:        "#DC2626",
  amber:      "#D97706",
};

function buildCreditMemoPdf(memo: CanonicalCreditMemoV1): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margins: { top: 48, bottom: 48, left: 54, right: 54 },
      info: {
        Title: `Credit Memo — ${memo.header.borrower_name}`,
        Author: memo.header.prepared_by,
        Subject: "Institutional Credit Memorandum",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;

    // Track Y manually to avoid orphan page breaks
    function checkPageBreak(neededPx = 60) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - neededPx) {
        doc.addPage();
      }
    }

    function sectionHeader(title: string) {
      checkPageBreak(40);
      doc.moveDown(0.6);
      const y = doc.y;
      doc.rect(L, y, pageWidth, 16).fill(COLORS.headerBg);
      doc.fillColor("#FFFFFF").fontSize(7.5).font("Helvetica-Bold")
        .text(title.toUpperCase(), L + 6, y + 4, { width: pageWidth - 12 });
      doc.fillColor(COLORS.black);
      doc.y = y + 20;
    }

    function labelValue(label: string, value: string, opts?: { indent?: number }) {
      const x = L + (opts?.indent ?? 0);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text(label, x, doc.y, { continued: true, width: 150 });
      doc.font("Helvetica").fillColor(COLORS.black)
        .text(`  ${value}`, { width: pageWidth - 150 - (opts?.indent ?? 0) });
    }

    function divider() {
      const y = doc.y + 2;
      doc.moveTo(L, y).lineTo(L + pageWidth, y).strokeColor(COLORS.lineGray).lineWidth(0.5).stroke();
      doc.y = y + 4;
    }

    // ── HEADER BLOCK ──────────────────────────────────────────────────────────

    // Top bar
    doc.rect(L, doc.y, pageWidth, 48).fill(COLORS.headerBg);
    const topY = doc.y;
    doc.fillColor("#FFFFFF").fontSize(16).font("Helvetica-Bold")
      .text("CREDIT MEMORANDUM", L + 10, topY + 8, { width: pageWidth - 20 });
    doc.fontSize(8).font("Helvetica").fillColor("#94A3B8")
      .text(`${memo.header.action_type}  ·  ${memo.header.date}  ·  Prepared by ${memo.header.prepared_by}`,
        L + 10, topY + 30, { width: pageWidth - 20 });
    doc.y = topY + 56;

    // Borrower / Lender row
    doc.rect(L, doc.y, pageWidth, 36).fill(COLORS.sectionBg);
    const midY = doc.y;
    doc.fillColor(COLORS.lightGray).fontSize(7).font("Helvetica-Bold")
      .text("BORROWER / APPLICANT", L + 8, midY + 4);
    doc.fillColor(COLORS.black).fontSize(10).font("Helvetica-Bold")
      .text(memo.header.borrower_name, L + 8, midY + 14);
    doc.fillColor(COLORS.lightGray).fontSize(7).font("Helvetica-Bold")
      .text("LENDER", L + pageWidth / 2, midY + 4);
    doc.fillColor(COLORS.gray).fontSize(8.5).font("Helvetica")
      .text(memo.header.lender_name, L + pageWidth / 2, midY + 14);
    doc.y = midY + 44;

    if (memo.header.guarantors.length) {
      doc.fontSize(8).font("Helvetica").fillColor(COLORS.gray)
        .text(`Guarantors: ${memo.header.guarantors.join(", ")}`, L, doc.y);
      doc.moveDown(0.3);
    }

    // ── FINANCING REQUEST ─────────────────────────────────────────────────────

    sectionHeader("Financing Request");

    const km = memo.key_metrics;
    const col1 = [
      ["Loan Amount",   pendingNum(km.loan_amount.value, fmt$)],
      ["Product",        pending(km.product)],
      ["Rate",           pending(km.rate_summary)],
      ["Term",           km.term_months ? `${km.term_months} months` : "Pending"],
      ["Amortization",  km.amort_months ? `${km.amort_months} months` : "Pending"],
      ["Monthly Pmt",   pendingNum(km.monthly_payment, fmt$)],
    ];
    const col2 = [
      ["DSCR (UW)",     fmtRatio(km.dscr_uw.value)],
      ["DSCR (Stress)", fmtRatio(km.dscr_stressed.value)],
      ["LTV Gross",     km.ltv_gross.value ? fmtPct(km.ltv_gross.value * 100) : "—"],
      ["LTV Net",       km.ltv_net.value ? fmtPct(km.ltv_net.value * 100) : "—"],
      ["Disc. Coverage",fmtRatio(km.discounted_coverage.value)],
      ["Prepayment",    km.prepayment_penalty || "None"],
    ];

    const halfW = (pageWidth - 10) / 2;
    const startY = doc.y;

    col1.forEach(([lbl, val], i) => {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text(lbl, L, startY + i * 14, { width: halfW, continued: true });
      doc.font("Helvetica").fillColor(COLORS.black).text(`  ${val}`);
    });

    col2.forEach(([lbl, val], i) => {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text(lbl, L + halfW + 10, startY + i * 14, { width: halfW, continued: true });
      doc.font("Helvetica").fillColor(COLORS.black).text(`  ${val}`);
    });

    doc.y = startY + col1.length * 14 + 6;

    // ── DEAL SUMMARY ──────────────────────────────────────────────────────────

    sectionHeader("Deal Summary / Purpose");
    doc.fontSize(8.5).font("Helvetica").fillColor(COLORS.black)
      .text(pending(memo.transaction_overview.loan_request.purpose), L, doc.y,
        { width: pageWidth, lineGap: 2 });
    doc.moveDown(0.4);

    // ── SOURCES & USES ────────────────────────────────────────────────────────

    sectionHeader("Sources & Uses");
    const su = memo.sources_uses;
    const suRows = [
      ["Bank Loan",      fmt$(su.bank_loan_total.value)],
      ["Borrower Equity",fmt$(su.borrower_equity.value)],
      ["Total Project",  fmt$(su.total_project_cost.value)],
    ];
    suRows.forEach(([lbl, val]) => {
      labelValue(lbl, val);
      divider();
    });
    doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(COLORS.lightGray)
      .text(`Equity %: ${su.borrower_equity_pct.value ? fmtPct(su.borrower_equity_pct.value * 100) : "Pending"}  ·  Source: ${su.equity_source_description}`,
        L, doc.y);
    doc.moveDown(0.3);

    // ── COLLATERAL ────────────────────────────────────────────────────────────

    sectionHeader("Collateral Analysis");
    const col = memo.collateral;
    if (col.property_description && col.property_description !== "Pending") {
      doc.fontSize(8.5).font("Helvetica").fillColor(COLORS.black)
        .text(col.property_description, L, doc.y, { width: pageWidth, lineGap: 2 });
      doc.moveDown(0.3);
    }

    const collRows: [string, string][] = [
      ["Gross Collateral Value",  fmt$(col.total_gross)],
      ["Net Collateral Value",    fmt$(col.total_net)],
      ["Loan Amount",             fmt$(col.loan_amount)],
      ["LTV Gross",               col.ltv_gross.value ? fmtPct(col.ltv_gross.value * 100) : "—"],
      ["LTV Net",                 col.ltv_net.value ? fmtPct(col.ltv_net.value * 100) : "—"],
      ["Discounted Coverage",     fmtRatio(col.discounted_coverage.value)],
      ["As-Is Value",             fmt$(col.valuation.as_is.value)],
      ["Stabilized Value",        fmt$(col.valuation.stabilized.value)],
    ];
    collRows.forEach(([lbl, val]) => { labelValue(lbl, val); divider(); });

    // ── ELIGIBILITY ───────────────────────────────────────────────────────────

    sectionHeader("Eligibility");
    const elig = memo.eligibility;
    const eligRows: [string, string][] = [
      ["NAICS Code",   pending(elig.naics_code)],
      ["Industry",     pending(elig.naics_description)],
      ["Revenue",      pendingNum(elig.applicant_revenue, fmt$)],
      ["Credit Elsewhere", elig.credit_available_elsewhere],
    ];
    eligRows.forEach(([lbl, val]) => { labelValue(lbl, val); divider(); });

    // ── BUSINESS SUMMARY ──────────────────────────────────────────────────────

    sectionHeader("Business & Industry Analysis");
    const bs = memo.business_summary;
    doc.fontSize(8.5).font("Helvetica").fillColor(COLORS.black)
      .text(pending(bs.business_description), L, doc.y, { width: pageWidth, lineGap: 2 });
    doc.moveDown(0.3);

    if (memo.business_industry_analysis) {
      const bia = memo.business_industry_analysis;
      const narrative = bia.credit_thesis || bia.industry_overview;
      if (narrative && narrative !== "Pending") {
        doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.accent)
          .text("Credit Thesis / Industry Overview", L, doc.y);
        doc.fontSize(8).font("Helvetica").fillColor(COLORS.black)
          .text(narrative.slice(0, 1200) + (narrative.length > 1200 ? "…" : ""),
            L, doc.y, { width: pageWidth, lineGap: 2 });
        doc.moveDown(0.3);
      }

      if (bia.risk_indicators?.length) {
        checkPageBreak(40);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
          .text("Research Risk Indicators", L, doc.y);
        doc.moveDown(0.2);
        bia.risk_indicators.slice(0, 6).forEach((ri) => {
          const color = ri.level === "high" ? COLORS.red : ri.level === "medium" ? COLORS.amber : COLORS.green;
          doc.circle(L + 4, doc.y + 4, 3).fill(color);
          doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
            .text(ri.summary, L + 12, doc.y, { width: pageWidth - 12, lineGap: 1 });
        });
      }
    }

    // ── MANAGEMENT ────────────────────────────────────────────────────────────

    if (memo.management_qualifications.principals.length) {
      sectionHeader("Management Qualifications");
      memo.management_qualifications.principals.forEach((p) => {
        checkPageBreak(30);
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(COLORS.black)
          .text(`${p.name}${p.title ? ` — ${p.title}` : ""}${p.ownership_pct ? `  (${p.ownership_pct}%)` : ""}`,
            L, doc.y);
        if (p.bio && p.bio !== "Pending" && !p.bio.startsWith("Pending —")) {
          doc.fontSize(8).font("Helvetica").fillColor(COLORS.gray)
            .text(p.bio.slice(0, 400), L, doc.y, { width: pageWidth, lineGap: 2 });
        }
        doc.moveDown(0.3);
      });
    }

    // ── FINANCIAL ANALYSIS ────────────────────────────────────────────────────

    sectionHeader("Financial Analysis");

    // Debt Coverage Table
    if (memo.financial_analysis.debt_coverage_table.length) {
      checkPageBreak(80);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Debt Coverage Analysis", L, doc.y);
      doc.moveDown(0.3);

      const dcRows = memo.financial_analysis.debt_coverage_table;
      const dcCols: Array<{ label: string; fn: (r: DebtCoverageRow) => string; w: number }> = [
        { label: "Period",    fn: r => r.period_end,                          w: 62 },
        { label: "Revenue",   fn: r => fmt$(r.revenue),                       w: 60 },
        { label: "Net Inc",   fn: r => fmt$(r.net_income),                    w: 60 },
        { label: "+Dep",      fn: r => fmt$(r.addback_depreciation),          w: 48 },
        { label: "+Int",      fn: r => fmt$(r.addback_interest),              w: 48 },
        { label: "CF Avail",  fn: r => fmt$(r.cash_flow_available),           w: 58 },
        { label: "Debt Svc",  fn: r => fmt$(r.debt_service),                  w: 56 },
        { label: "DSCR",      fn: r => fmtRatio(r.dscr),                     w: 42 },
        { label: "Stress",    fn: r => fmtRatio(r.dscr_stressed),             w: 42 },
      ];

      // Header row
      let cx = L;
      const thY = doc.y;
      doc.rect(L, thY, pageWidth, 13).fill(COLORS.sectionBg);
      dcCols.forEach((c) => {
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor(COLORS.gray)
          .text(c.label, cx + 2, thY + 3, { width: c.w - 4 });
        cx += c.w;
      });
      doc.y = thY + 15;

      dcRows.forEach((row, ri) => {
        checkPageBreak(14);
        const rowY = doc.y;
        if (ri % 2 === 0) doc.rect(L, rowY, pageWidth, 13).fill("#FAFAFA");
        cx = L;
        dcCols.forEach((c) => {
          doc.fontSize(7).font("Helvetica").fillColor(COLORS.black)
            .text(c.fn(row), cx + 2, rowY + 3, { width: c.w - 4 });
          cx += c.w;
        });
        doc.y = rowY + 14;
      });
      doc.moveDown(0.4);
    }

    // Income Statement Table
    if (memo.financial_analysis.income_statement_table.length) {
      checkPageBreak(80);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Income Statement (Multi-Period)", L, doc.y);
      doc.moveDown(0.3);

      const isRows = memo.financial_analysis.income_statement_table;
      const isMetrics: Array<{ label: string; fn: (r: IncomeStatementRow) => string; bold?: boolean }> = [
        { label: "Revenue",            fn: r => fmt$(r.revenue) },
        { label: "Cost of Goods Sold", fn: r => fmt$(r.cogs) },
        { label: "Gross Profit",       fn: r => fmt$(r.gross_profit),      bold: true },
        { label: "Operating Expenses", fn: r => fmt$(r.operating_expenses) },
        { label: "Operating Income",   fn: r => fmt$(r.operating_income) },
        { label: "Net Income",         fn: r => fmt$(r.net_income),        bold: true },
        { label: "EBITDA",             fn: r => fmt$(r.ebitda),            bold: true },
        { label: "Depreciation",       fn: r => fmt$(r.depreciation) },
        { label: "Interest Expense",   fn: r => fmt$(r.interest_expense) },
      ];

      const labelColW = 130;
      const dataColW = Math.min(72, (pageWidth - labelColW) / isRows.length);

      // Header
      const isHY = doc.y;
      doc.rect(L, isHY, pageWidth, 13).fill(COLORS.sectionBg);
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Item", L + 2, isHY + 3, { width: labelColW - 4 });
      isRows.forEach((r, ci) => {
        doc.text(r.period_end, L + labelColW + ci * dataColW + 2, isHY + 3,
          { width: dataColW - 4, align: "right" });
      });
      doc.y = isHY + 15;

      isMetrics.forEach((m, mi) => {
        checkPageBreak(13);
        const mY = doc.y;
        if (mi % 2 === 0) doc.rect(L, mY, pageWidth, 13).fill("#FAFAFA");
        const fontFace = m.bold ? "Helvetica-Bold" : "Helvetica";
        doc.fontSize(7).font(fontFace).fillColor(COLORS.black)
          .text(m.label, L + 2, mY + 3, { width: labelColW - 4 });
        isRows.forEach((r, ci) => {
          doc.font(fontFace).text(m.fn(r), L + labelColW + ci * dataColW + 2, mY + 3,
            { width: dataColW - 4, align: "right" });
        });
        doc.y = mY + 14;
      });
      doc.moveDown(0.4);
    }

    // Balance Sheet Table (permanent fix — from SL_ facts, spread-independent)
    const bsRows = (memo.financial_analysis as any).balance_sheet_table as BalanceSheetRow[] | undefined ?? [];
    if (bsRows.length) {
      checkPageBreak(80);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Balance Sheet (Multi-Period)", L, doc.y);
      doc.moveDown(0.3);

      const bsMetrics: Array<{ label: string; fn: (r: BalanceSheetRow) => string; bold?: boolean }> = [
        { label: "Cash & Equivalents",  fn: r => fmt$(r.cash_and_equivalents) },
        { label: "Total Current Assets",fn: r => fmt$(r.total_current_assets) },
        { label: "PP&E (Gross)",         fn: r => fmt$(r.ppe_gross) },
        { label: "Accum. Depreciation", fn: r => fmt$(r.accumulated_depreciation) },
        { label: "Total Assets",        fn: r => fmt$(r.total_assets),        bold: true },
        { label: "Accounts Payable",    fn: r => fmt$(r.accounts_payable) },
        { label: "Notes / Mortgages",   fn: r => fmt$(r.mortgages_notes_bonds) },
        { label: "Total Liabilities",   fn: r => fmt$(r.total_liabilities),   bold: true },
        { label: "Retained Earnings",   fn: r => fmt$(r.retained_earnings) },
        { label: "Total Equity",        fn: r => fmt$(r.total_equity),        bold: true },
        { label: "L + E (check)",       fn: r => fmt$(r.liabilities_plus_equity) },
      ];

      const bsLabelW = 130;
      const bsDataW = Math.min(72, (pageWidth - bsLabelW) / bsRows.length);

      // Header
      const bsHY = doc.y;
      doc.rect(L, bsHY, pageWidth, 13).fill(COLORS.sectionBg);
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Item", L + 2, bsHY + 3, { width: bsLabelW - 4 });
      bsRows.forEach((r, ci) => {
        doc.text(r.period_end, L + bsLabelW + ci * bsDataW + 2, bsHY + 3,
          { width: bsDataW - 4, align: "right" });
      });
      doc.y = bsHY + 15;

      bsMetrics.forEach((m, mi) => {
        checkPageBreak(13);
        const mY = doc.y;
        if (mi % 2 === 0) doc.rect(L, mY, pageWidth, 13).fill("#FAFAFA");
        const fontFace = m.bold ? "Helvetica-Bold" : "Helvetica";
        doc.fontSize(7).font(fontFace).fillColor(COLORS.black)
          .text(m.label, L + 2, mY + 3, { width: bsLabelW - 4 });
        bsRows.forEach((r, ci) => {
          doc.font(fontFace).text(m.fn(r), L + bsLabelW + ci * bsDataW + 2, mY + 3,
            { width: bsDataW - 4, align: "right" });
        });
        doc.y = mY + 14;
      });
      doc.moveDown(0.4);
    }

    // Global Cash Flow summary line
    const gcf = memo.global_cash_flow;
    if (gcf.cash_available.value !== null || gcf.total_obligations.value !== null) {
      checkPageBreak(30);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Global Cash Flow Summary", L, doc.y);
      doc.moveDown(0.2);
      const gcfItems: [string, string][] = [
        ["Cash Available",      fmt$(gcf.cash_available.value)],
        ["Total Obligations",   fmt$(gcf.total_obligations.value)],
        ["Global DSCR",         fmtRatio(gcf.global_dscr.value)],
      ];
      gcfItems.forEach(([lbl, val]) => { labelValue(lbl, val); });
      doc.moveDown(0.3);
    }

    // ── PERSONAL FINANCIAL STATEMENTS ─────────────────────────────────────────

    const pfsList = memo.personal_financial_statements.filter(
      p => p.total_assets !== null || p.net_worth !== null || p.annual_income !== null
    );
    if (pfsList.length) {
      sectionHeader("Personal Financial Statements");
      pfsList.forEach((p, pi) => {
        checkPageBreak(50);
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(COLORS.black)
          .text(`Guarantor ${pi + 1}${p.name ? `: ${p.name}` : ""}`, L, doc.y);
        doc.moveDown(0.2);
        const pfsItems: [string, string][] = [
          ["Total Assets",     fmt$(p.total_assets)],
          ["Total Liabilities",fmt$(p.total_liabilities)],
          ["Net Worth",        fmt$(p.net_worth)],
          ["Annual Income",    fmt$(p.annual_income)],
        ];
        pfsItems.forEach(([lbl, val]) => { labelValue(lbl, val, { indent: 10 }); });
        doc.moveDown(0.3);
      });
    }

    // ── STRENGTHS & WEAKNESSES ────────────────────────────────────────────────

    const sw = memo.strengths_weaknesses;
    if (sw.strengths.length || sw.weaknesses.length) {
      sectionHeader("Strengths & Weaknesses");
      const swStartY = doc.y;
      const swHalf = (pageWidth - 12) / 2;

      // Strengths
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.green)
        .text("Strengths", L, swStartY);
      let syOffset = 12;
      sw.strengths.slice(0, 6).forEach((s) => {
        checkPageBreak(12);
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
          .text(`+ ${s.point}`, L, swStartY + syOffset, { width: swHalf, lineGap: 1 });
        syOffset += 14;
      });

      // Weaknesses
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.red)
        .text("Weaknesses", L + swHalf + 12, swStartY);
      let wyOffset = 12;
      sw.weaknesses.slice(0, 6).forEach((w) => {
        checkPageBreak(12);
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
          .text(`⊒ ${w.point}`, L + swHalf + 12, swStartY + wyOffset, { width: swHalf, lineGap: 1 });
        wyOffset += 14;
      });

      doc.y = swStartY + Math.max(syOffset, wyOffset) + 4;
    }

    // ── RISK FACTORS ──────────────────────────────────────────────────────────

    if (memo.risk_factors.length) {
      sectionHeader("Risk Factors");
      memo.risk_factors.slice(0, 8).forEach((rf) => {
        checkPageBreak(24);
        const sevColor = rf.severity === "high" ? COLORS.red : rf.severity === "medium" ? COLORS.amber : COLORS.gray;
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor(sevColor)
          .text(`[${rf.severity.toUpperCase()}]`, L, doc.y, { continued: true, width: 40 });
        doc.font("Helvetica").fillColor(COLORS.black)
          .text(`  ${rf.risk}`, { width: pageWidth - 40 });
        rf.mitigants.forEach((m) => {
          doc.fontSize(7).font("Helvetica-Oblique").fillColor(COLORS.gray)
            .text(`    ↳ ${m}`, L, doc.y, { width: pageWidth });
        });
        doc.moveDown(0.2);
      });
    }

    // ── POLICY EXCEPTIONS ─────────────────────────────────────────────────────

    if (memo.policy_exceptions.length) {
      sectionHeader("Policy Exceptions");
      memo.policy_exceptions.forEach((pe) => {
        checkPageBreak(24);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.amber).text(pe.exception, L, doc.y);
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.gray)
          .text(`Rationale: ${pe.rationale}`, L, doc.y, { width: pageWidth });
        doc.moveDown(0.3);
      });
    }

    // ── RECOMMENDATION ────────────────────────────────────────────────────────

    sectionHeader("Recommendation / Approvals");
    const rec = memo.recommendation;

    const verdictColor = rec.verdict === "approve" ? COLORS.green
      : rec.verdict === "caution" ? COLORS.amber
      : rec.verdict === "decline_risk" ? COLORS.red
      : COLORS.gray;

    const verdictLabel = rec.verdict === "approve" ? "APPROVE"
      : rec.verdict === "caution" ? "CONDITIONAL APPROVAL"
      : rec.verdict === "decline_risk" ? "DECLINE"
      : "PENDING";

    // Verdict badge
    const vY = doc.y;
    doc.rect(L, vY, 120, 22).fill(verdictColor);
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#FFFFFF")
      .text(verdictLabel, L + 4, vY + 6, { width: 112, align: "center" });

    if (rec.risk_grade && rec.risk_grade !== "pending") {
      doc.rect(L + 126, vY, 60, 22).fill(COLORS.sectionBg);
      doc.rect(L + 126, vY, 60, 22).stroke(COLORS.lineGray);
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(COLORS.black)
        .text(`Grade: ${rec.risk_grade}`, L + 128, vY + 7, { width: 56 });
    }

    doc.y = vY + 30;

    if (rec.headline) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(COLORS.black)
        .text(rec.headline, L, doc.y, { width: pageWidth });
      doc.moveDown(0.3);
    }

    if (rec.rationale.length) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray).text("Rationale", L, doc.y);
      rec.rationale.forEach((r) => {
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
          .text(`• ${r}`, L + 8, doc.y, { width: pageWidth - 8 });
      });
      doc.moveDown(0.2);
    }

    if (rec.key_drivers.length) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray).text("Key Drivers", L, doc.y);
      rec.key_drivers.forEach((d) => {
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
          .text(`• ${d}`, L + 8, doc.y, { width: pageWidth - 8 });
      });
      doc.moveDown(0.2);
    }

    // ── CONDITIONS ────────────────────────────────────────────────────────────

    if (memo.conditions.precedent.length) {
      checkPageBreak(40);
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
        .text("Conditions Precedent to Closing", L, doc.y);
      memo.conditions.precedent.slice(0, 10).forEach((c) => {
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.black)
          .text(`• ${c}`, L + 8, doc.y, { width: pageWidth - 8 });
      });
      doc.moveDown(0.3);
    }

    // ── SIGNATURE BLOCK ───────────────────────────────────────────────────────

    checkPageBreak(100);
    doc.moveDown(0.5);
    divider();
    doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.gray)
      .text("APPROVAL SIGNATURES", L, doc.y);
    doc.moveDown(0.5);

    const sigRoles = ["Loan Officer", "Credit Officer", "Senior Credit Officer", "SVP / EVP Approval"];
    const sigW = (pageWidth - 20) / 2;
    sigRoles.forEach((role, i) => {
      const sx = L + (i % 2) * (sigW + 20);
      const sy = doc.y + (i < 2 ? 0 : 40);
      if (i === 2) doc.moveDown(2.5);
      doc.fontSize(7).font("Helvetica").fillColor(COLORS.lightGray)
        .text(role, sx, sy);
      doc.moveTo(sx, sy + 24).lineTo(sx + sigW - 10, sy + 24)
        .strokeColor(COLORS.lineGray).lineWidth(0.75).stroke();
      doc.fontSize(7).fillColor(COLORS.lightGray)
        .text("Signature / Date", sx, sy + 27);
    });

    doc.moveDown(1);

    // ── FOOTER ────────────────────────────────────────────────────────────────

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(6.5).font("Helvetica").fillColor(COLORS.lightGray)
        .text(
          `${memo.header.lender_name}  ·  ${memo.header.borrower_name}  ·  Generated ${memo.generated_at.slice(0, 10)}  ·  Page ${i + 1} of ${range.count}`,
          L,
          doc.page.height - doc.page.margins.bottom + 10,
          { width: pageWidth, align: "center" },
        );
    }

    doc.end();
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handlePdfRequest(dealId: string) {
  try {
    await requireDealAccess(dealId);
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) {
      return NextResponse.json({ ok: false, error: "no_bank_selected" }, { status: 401 });
    }

    // Phase 81: Trust enforcement — PDF export requires committee-grade research
    const { loadAndEnforceResearchTrust } = await import("@/lib/research/trustEnforcement");
    const trustCheck = await loadAndEnforceResearchTrust(dealId, "committee_packet");
    if (!trustCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: trustCheck.reason },
        { status: 400 },
      );
    }

    const res = await buildCanonicalCreditMemo({ dealId, bankId: bankPick.bankId });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }

    const pdfBuffer = await buildCreditMemoPdf(res.memo);

    const borrowerSlug = (res.memo.header.borrower_name ?? dealId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);

    // CI-RESTORE 2026-04-24: wrap Node Buffer in Uint8Array to satisfy BodyInit.
    // Node 22's @types/node narrowed Buffer to Buffer<ArrayBufferLike>, which
    // no longer matches BodyInit's union. Uint8Array is part of BodyInit and
    // shares the underlying bytes (no copy), so this is a zero-cost widening.
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="credit-memo-${borrowerSlug}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[canonical/pdf] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  return handlePdfRequest(dealId);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  return handlePdfRequest(dealId);
}
