// src/lib/finance/underwriting/dscr.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";

export type DscrInputs = {
  annual_debt_service: number | null; // user-entered or derived later
};

export type DscrResult = {
  year: number | null;
  cfads: number | null;
  annual_debt_service: number | null;
  dscr: number | null;
  flags: string[];
};

export function computeDscr(spread: TaxSpread, inputs: DscrInputs): DscrResult {
  const flags: string[] = [];

  const year = spread.tax_year ?? null;
  const cfads = spread.cfads_proxy ?? spread.ebitda ?? null;
  const ads = inputs.annual_debt_service;

  let dscr: number | null = null;

  if (cfads === null) flags.push("Missing CFADS/EBITDA");
  if (ads === null) flags.push("Missing Annual Debt Service");

  if (cfads !== null && ads !== null) {
    if (ads <= 0) {
      flags.push("Annual Debt Service must be > 0");
    } else {
      dscr = cfads / ads;
      if (dscr < 1.0) flags.push("DSCR < 1.00x");
      else if (dscr < 1.15) flags.push("DSCR < 1.15x");
    }
  }

  if (cfads !== null && cfads < 0) flags.push("Negative CFADS");

  return { year, cfads, annual_debt_service: ads, dscr, flags };
}