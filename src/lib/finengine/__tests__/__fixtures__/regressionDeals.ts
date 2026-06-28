/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 3: multi-deal regression fixtures.
 *
 * Compact, realistic certified-row sets (OmniCare-shaped: M1 + NET_INCOME base,
 * full income statement + Schedule-L, plus the placeholder-constant garbage and
 * personal-pollution the certified layer must clean). Each should validate
 * cutover-clean (0 UNEXPECTED). Adding a deal here widens the regression net.
 */

import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const GEM = "gemini_primary_v1", DET = "taxReturnExtractor:v2:deterministic";
function r(k: string, p: string, v: number, sct: string, owner: string, conf: number, ext: string): CertifiedFactRow {
  return { fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: sct, owner_type: owner, confidence: conf, extractor: ext, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const b = (k: string, p: string, v: number, conf = 0.8, ext = GEM) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL", conf, ext);

/** Build a two-period business deal from headline numbers, with garbage + pollution mixed in. */
function deal(opts: {
  rev: [number, number]; cogs: [number, number]; gp: [number, number]; ni: [number, number];
  dep: [number, number]; assets: number; equity: number; liab: number; ca: number; cl: number;
  personalPollution?: number;
}): CertifiedFactRow[] {
  const P = ["2023-12-31", "2024-12-31"] as const;
  const rows: CertifiedFactRow[] = [];
  P.forEach((p, i) => {
    rows.push(b("GROSS_RECEIPTS", p, opts.rev[i]), b("COST_OF_GOODS_SOLD", p, opts.cogs[i]), b("GROSS_PROFIT", p, opts.gp[i]));
    rows.push(b("NET_INCOME", p, opts.ni[i]), b("M1_TAXABLE_INCOME", p, opts.ni[i]), b("M1_TAXABLE_INCOME", p, 27, 0.5, DET)); // constant-bug
    rows.push(b("DEPRECIATION", p, opts.dep[i]));
  });
  // Latest-period balance sheet (+ a placeholder-constant garbage cash on both periods).
  rows.push(b("SL_TOTAL_ASSETS", "2024-12-31", opts.assets), b("SL_TOTAL_EQUITY", "2024-12-31", opts.equity), b("SL_TOTAL_LIABILITIES", "2024-12-31", opts.liab));
  rows.push(b("TOTAL_CURRENT_ASSETS", "2024-12-31", opts.ca), b("TOTAL_CURRENT_LIABILITIES", "2024-12-31", opts.cl));
  rows.push(b("SL_CASH", "2023-12-31", 2, 0.5, DET), b("SL_CASH", "2024-12-31", 2, 0.5, DET)); // constant garbage, no real sibling → dropped? kept; harmless
  if (opts.personalPollution != null) {
    rows.push(r("TAXABLE_INCOME", "2023-12-31", opts.personalPollution, "PERSONAL_TAX_RETURN", "DEAL", 0.8, GEM));
  }
  return rows;
}

export const REGRESSION_DEALS: Array<{ id: string; name: string; rows: CertifiedFactRow[] }> = [
  {
    id: "reg-omnicare", name: "OmniCare-shaped (loss year + recovery)",
    rows: deal({ rev: [15088769, 28767069], cogs: [13292890, 25233470], gp: [1472421, 3533599], ni: [-457567, 200925], dep: [61656, 210207], assets: 6800000, equity: 5300000, liab: 1500000, ca: 6800000, cl: 1500000, personalPollution: 249968 }),
  },
  {
    id: "reg-distributor", name: "Thin-margin distributor",
    rows: deal({ rev: [9000000, 9500000], cogs: [7650000, 8075000], gp: [1350000, 1425000], ni: [320000, 360000], dep: [80000, 90000], assets: 4000000, equity: 1800000, liab: 2200000, ca: 2600000, cl: 1900000 }),
  },
  {
    id: "reg-services", name: "Professional services (high margin)",
    rows: deal({ rev: [4200000, 4800000], cogs: [1260000, 1440000], gp: [2940000, 3360000], ni: [520000, 610000], dep: [40000, 45000], assets: 2200000, equity: 1500000, liab: 700000, ca: 1900000, cl: 600000 }),
  },
];
