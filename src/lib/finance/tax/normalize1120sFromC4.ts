// src/lib/finance/tax/normalize1120sFromC4.ts

import type { Irs1120SNormalized } from "./irs1120sTypes";
import { flattenStrings, findLabeledAmount } from "./labelExtract";

function score(found: number, total: number): number {
  if (total <= 0) return 0.2;
  const r = found / total;
  // floor at 0.25 so we don’t show “0%” for partial parses
  return Math.max(0.25, Math.min(0.95, r));
}

export function normalize1120sFromC4(c4: unknown, taxYear: number | null): Irs1120SNormalized {
  const flat = flattenStrings(c4);

  const fields: Array<{
    key: keyof Omit<Irs1120SNormalized, "tax_year" | "confidence" | "notes" | "ebitda_proxy" | "cfads_proxy">;
    re: RegExp;
  }> = [
    { key: "gross_receipts", re: /\b(gross\s+receipts|sales)\b/i },
    { key: "returns_allowances", re: /\b(returns?\s+and\s+allowances?)\b/i },
    { key: "net_receipts", re: /\b(net\s+(receipts|sales))\b/i },
    { key: "cogs", re: /\b(cost\s+of\s+goods\s+sold|cogs)\b/i },
    { key: "gross_profit", re: /\b(gross\s+profit)\b/i },
    { key: "total_income", re: /\b(total\s+income)\b/i },
    { key: "total_deductions", re: /\b(total\s+deductions)\b/i },
    { key: "ordinary_business_income", re: /\b(ordinary\s+business\s+(income|loss))\b/i },

    { key: "officer_comp", re: /\b(compensation\s+of\s+officers|officer\s+comp)\b/i },
    { key: "wages", re: /\b(salaries\s+and\s+wages|wages)\b/i },
    { key: "repairs", re: /\b(repairs?\s+and\s+maintenance)\b/i },
    { key: "bad_debts", re: /\b(bad\s+debts?)\b/i },
    { key: "rents", re: /\b(rents?)\b/i },
    { key: "taxes_licenses", re: /\b(taxes?\s+and\s+licenses?)\b/i },
    { key: "interest", re: /\b(interest)\b/i },
    { key: "depreciation", re: /\b(depreciation)\b/i },
    { key: "advertising", re: /\b(advertising)\b/i },
    { key: "pension", re: /\b(pension|profit-sharing)\b/i },
    { key: "employee_benefits", re: /\b(employee\s+benefit\s+programs?)\b/i },

    // heuristics (often embedded)
    { key: "meals", re: /\b(meals?\b|meals\s+and\s+entertainment)\b/i },
    { key: "travel", re: /\b(travel)\b/i },
  ];

  const out: Omit<Irs1120SNormalized, "confidence" | "notes"> = {
    tax_year: taxYear,

    gross_receipts: null,
    returns_allowances: null,
    net_receipts: null,
    cogs: null,
    gross_profit: null,
    total_income: null,
    total_deductions: null,
    ordinary_business_income: null,

    officer_comp: null,
    wages: null,
    repairs: null,
    bad_debts: null,
    rents: null,
    taxes_licenses: null,
    interest: null,
    depreciation: null,
    advertising: null,
    pension: null,
    employee_benefits: null,
    meals: null,
    travel: null,

    ebitda_proxy: null,
    cfads_proxy: null,
  };

  const notes: string[] = [];
  let found = 0;

  for (const f of fields) {
    const r = findLabeledAmount(flat, f.re);
    if (r.value !== null) {
      (out as Record<string, unknown>)[f.key] = r.value;
      found++;
      if (r.evidence) notes.push(`${String(f.key)}: ${r.evidence}`);
    }
  }

  // Derived: gross profit if missing
  if (out.gross_profit === null && out.net_receipts !== null && out.cogs !== null) {
    out.gross_profit = out.net_receipts - out.cogs;
  }
  if (out.net_receipts === null && out.gross_receipts !== null && out.returns_allowances !== null) {
    out.net_receipts = out.gross_receipts - out.returns_allowances;
  }

  // EBITDA proxy (v1): OBI + interest + depreciation (+ amortization if we ever find it later)
  const obi = out.ordinary_business_income;
  const dep = out.depreciation ?? 0;
  const int = out.interest ?? 0;

  if (obi !== null) {
    out.ebitda_proxy = obi + dep + int;
    // CFADS proxy (v1): EBITDA proxy + officer comp (common underwriting addback)
    const off = out.officer_comp ?? 0;
    out.cfads_proxy = out.ebitda_proxy + off;

    // CFADS margin note
    const rev = out.net_receipts ?? out.gross_receipts;
    if (rev !== null && rev !== 0) {
      const margin = Math.round((out.cfads_proxy / rev) * 100);
      notes.push(`CFADS margin: ${margin}%`);
    }
  }

  const confidence = score(found, fields.length);

  return {
    ...out,
    confidence,
    notes: notes.slice(0, 10),
  };
}