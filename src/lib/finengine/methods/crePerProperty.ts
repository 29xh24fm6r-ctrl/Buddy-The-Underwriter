/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream C — per-property CRE analysis.
 *
 * Elite CRE underwriting sizes by the WEAKEST property, not a blended figure.
 * This computes NOI / DSCR / debt-yield / LTV / cap-rate PER property (reusing
 * metrics/ratios.ts) and aggregates most-restrictively: the binding LTV is the
 * highest, the binding DSCR / debt-yield the lowest, and the weakest property is
 * flagged. Registry floors drive the breach flags (NG4). Pure — no DB.
 *
 * §0 note (upstream modeling): per-property VALUE / lien / advance-rate are
 * modeled in `deal_collateral_items`, so per-property LTV is wireable today.
 * Per-property NOI is NOT modeled (NOI_TTM is deal-level), so per-property DSCR
 * and debt-yield require upstream per-property income modeling — when a
 * property's `noi` is null here, its income metrics degrade to null (the value
 * metrics still compute). This layer is ready for that wiring.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";
import { ltv as ltvRatio, dscr as dscrRatio, debtYield as debtYieldRatio, capRate as capRateRatio } from "@/lib/finengine/metrics/ratios";

export type PropertyInput = {
  id: string;
  label?: string;
  value: number; // appraised / market value
  loanAllocation: number; // loan amount allocated to this property
  noi?: number | null; // per-property NOI (null when only deal-level NOI exists)
  annualDebtService?: number | null; // per-property P&I (null when only blended exists)
  lienPosition?: number | null;
};

export type PerPropertyMetrics = {
  id: string;
  label: string;
  value: number;
  loanAllocation: number;
  noi: number | null;
  ltv: number | null;
  dscr: number | null;
  debtYield: number | null;
  capRate: number | null;
  lienPosition: number | null;
};

export type CrePortfolio = {
  properties: PerPropertyMetrics[];
  portfolio: {
    totalValue: number;
    totalLoan: number;
    totalNoi: number | null; // null when any property's NOI is unknown
    blendedLtv: number | null;
    blendedDscr: number | null;
    blendedDebtYield: number | null;
  };
  /** Most-restrictive (binding) metric across properties, with the property it came from. */
  binding: {
    ltv: { id: string; value: number } | null; // highest LTV
    dscr: { id: string; value: number } | null; // lowest DSCR
    debtYield: { id: string; value: number } | null; // lowest debt yield
  };
  weakestProperty: string | null;
  flags: string[];
};

const div = (a: number | null, b: number | null): number | null => (a == null || b == null || b === 0 ? null : a / b);

/** Per-property CRE metrics + most-restrictive portfolio aggregation. */
export function computePerPropertyCre(properties: PropertyInput[], ctx?: PolicyContext): CrePortfolio {
  const ltvMax = resolvePolicy("ltv_max", ctx).effective ?? 0.75;
  const dscrFloor = resolvePolicy("dscr_floor", ctx).effective ?? 1.2;
  const flags: string[] = [];

  const perProperty: PerPropertyMetrics[] = properties.map((p) => {
    const label = p.label ?? p.id;
    const noi = p.noi ?? null;
    const m: PerPropertyMetrics = {
      id: p.id,
      label,
      value: p.value,
      loanAllocation: p.loanAllocation,
      noi,
      ltv: ltvRatio(p.loanAllocation, p.value, ctx).value,
      dscr: noi != null ? dscrRatio(noi, p.annualDebtService ?? null, ctx).value : null,
      debtYield: noi != null ? debtYieldRatio(noi, p.loanAllocation).value : null,
      capRate: noi != null ? capRateRatio(noi, p.value).value : null,
      lienPosition: p.lienPosition ?? null,
    };
    if (m.ltv != null && m.ltv > ltvMax) flags.push(`${label}: LTV ${(m.ltv * 100).toFixed(0)}% exceeds cap ${(ltvMax * 100).toFixed(0)}%.`);
    if (m.dscr != null && m.dscr < dscrFloor) flags.push(`${label}: DSCR ${m.dscr.toFixed(2)}x below floor ${dscrFloor.toFixed(2)}x.`);
    if (m.lienPosition != null && m.lienPosition > 1) flags.push(`${label}: junior lien (position ${m.lienPosition}).`);
    return m;
  });

  const totalValue = properties.reduce((s, p) => s + p.value, 0);
  const totalLoan = properties.reduce((s, p) => s + p.loanAllocation, 0);
  const anyNoiMissing = perProperty.some((m) => m.noi == null);
  const totalNoi = anyNoiMissing ? null : perProperty.reduce((s, m) => s + (m.noi ?? 0), 0);
  const totalDebtService = properties.reduce((s, p) => s + (p.annualDebtService ?? 0), 0);

  // Binding (most-restrictive) across properties.
  const ltvs = perProperty.filter((m) => m.ltv != null);
  const dscrs = perProperty.filter((m) => m.dscr != null);
  const dys = perProperty.filter((m) => m.debtYield != null);
  const maxBy = <T>(arr: T[], f: (t: T) => number): T | null => (arr.length ? arr.reduce((a, b) => (f(b) > f(a) ? b : a)) : null);
  const minBy = <T>(arr: T[], f: (t: T) => number): T | null => (arr.length ? arr.reduce((a, b) => (f(b) < f(a) ? b : a)) : null);

  const bindLtv = maxBy(ltvs, (m) => m.ltv!);
  const bindDscr = minBy(dscrs, (m) => m.dscr!);
  const bindDy = minBy(dys, (m) => m.debtYield!);

  // Weakest property: the binding DSCR property, else the binding (highest) LTV property.
  const weakestProperty = bindDscr?.id ?? bindLtv?.id ?? null;

  return {
    properties: perProperty,
    portfolio: {
      totalValue,
      totalLoan,
      totalNoi,
      blendedLtv: div(totalLoan, totalValue),
      blendedDscr: totalNoi != null && totalDebtService > 0 ? totalNoi / totalDebtService : null,
      blendedDebtYield: div(totalNoi, totalLoan),
    },
    binding: {
      ltv: bindLtv ? { id: bindLtv.id, value: bindLtv.ltv! } : null,
      dscr: bindDscr ? { id: bindDscr.id, value: bindDscr.dscr! } : null,
      debtYield: bindDy ? { id: bindDy.id, value: bindDy.debtYield! } : null,
    },
    weakestProperty,
    flags,
  };
}
