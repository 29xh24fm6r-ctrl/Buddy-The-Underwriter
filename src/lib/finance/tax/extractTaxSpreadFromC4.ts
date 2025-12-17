// src/lib/finance/tax/extractTaxSpreadFromC4.ts

import type { TaxSpread } from "./taxSpreadTypes";
import { normalize1120sFromC4 } from "./normalize1120sFromC4";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return null;
    cur = cur[key];
  }
  return cur;
}

function bestOf(obj: unknown, paths: string[][]): number | null {
  for (const p of paths) {
    const v = pickNumber(getPath(obj, p));
    if (v !== null) return v;
  }
  return null;
}

export function extractTaxSpreadFromC4(c4: unknown, taxYear: number | null, docType?: string): TaxSpread {
  if (docType === "IRS_1120S") {
    const n = normalize1120sFromC4(c4, taxYear);

    return {
      tax_year: taxYear,
      revenue: n.net_receipts ?? n.gross_receipts,
      cogs: n.cogs,
      gross_profit: n.gross_profit,
      operating_expenses: n.total_deductions,
      ebitda: n.ebitda_proxy,
      interest: n.interest,
      depreciation: n.depreciation,
      amortization: null,
      net_income: n.ordinary_business_income,
      officer_comp: n.officer_comp,
      cfads_proxy: n.cfads_proxy,
      confidence: n.confidence,
      notes: n.notes,
    };
  }

  // v1 heuristic: support a few common shapes without assuming a fixed schema
  const revenue = bestOf(c4, [
    ["pl", "revenue"],
    ["income_statement", "revenue"],
    ["pnl", "revenue"],
    ["statement", "revenue"],
  ]);

  const cogs = bestOf(c4, [
    ["pl", "cogs"],
    ["income_statement", "cogs"],
    ["pnl", "cogs"],
    ["statement", "cogs"],
  ]);

  const gross_profit =
    bestOf(c4, [["pl", "gross_profit"], ["income_statement", "gross_profit"], ["pnl", "gross_profit"]]) ??
    (revenue !== null && cogs !== null ? revenue - cogs : null);

  const operating_expenses = bestOf(c4, [
    ["pl", "operating_expenses"],
    ["income_statement", "operating_expenses"],
    ["pnl", "operating_expenses"],
  ]);

  const ebitda = bestOf(c4, [
    ["pl", "ebitda"],
    ["income_statement", "ebitda"],
    ["pnl", "ebitda"],
  ]);

  const interest = bestOf(c4, [["pl", "interest"], ["income_statement", "interest"]]);
  const depreciation = bestOf(c4, [["pl", "depreciation"], ["income_statement", "depreciation"]]);
  const amortization = bestOf(c4, [["pl", "amortization"], ["income_statement", "amortization"]]);

  const net_income = bestOf(c4, [
    ["pl", "net_income"],
    ["income_statement", "net_income"],
    ["pnl", "net_income"],
  ]);

  // confidence: simple scoring based on how many key fields we found
  const found = [revenue, ebitda, net_income].filter((x) => x !== null).length;
  const confidence = found === 0 ? 0.2 : found === 1 ? 0.45 : found === 2 ? 0.7 : 0.85;

  const notes: string[] = [];
  if (gross_profit !== null && revenue !== null && revenue !== 0) {
    notes.push(`Gross margin: ${Math.round((gross_profit / revenue) * 100)}%`);
  }

  return {
    tax_year: taxYear,
    revenue,
    cogs,
    gross_profit,
    operating_expenses,
    ebitda,
    interest,
    depreciation,
    amortization,
    net_income,
    officer_comp: null,
    cfads_proxy: null,
    confidence,
    notes,
  };
}