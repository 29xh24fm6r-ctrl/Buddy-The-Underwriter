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
  // Dollar balance of any liens SENIOR to this loan (Tier-7). For a junior
  // (2nd+) position, true exposure LTV must include the senior debt ahead of us:
  // (seniorLienBalance + loanAllocation) ÷ value. Null/undefined ⇒ unknown; for a
  // junior position that produces a visible gap flag rather than a silent
  // understatement of leverage.
  seniorLienBalance?: number | null;
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
    const lienPosition = p.lienPosition ?? null;
    const isJunior = lienPosition != null && lienPosition > 1;

    // Tier-7: LTV must reflect all debt AT OR SENIOR TO this loan, not just our
    // own allocation. For a junior lien, add the senior balance ahead of us.
    const seniorLien = p.seniorLienBalance ?? 0;
    const exposureDebt = p.loanAllocation + seniorLien;

    const m: PerPropertyMetrics = {
      id: p.id,
      label,
      value: p.value,
      loanAllocation: p.loanAllocation,
      noi,
      ltv: ltvRatio(exposureDebt, p.value, ctx).value,
      dscr: noi != null ? dscrRatio(noi, p.annualDebtService ?? null, ctx).value : null,
      debtYield: noi != null ? debtYieldRatio(noi, p.loanAllocation).value : null,
      capRate: noi != null ? capRateRatio(noi, p.value).value : null,
      lienPosition,
    };
    if (m.ltv != null && m.ltv > ltvMax) flags.push(`${label}: LTV ${(m.ltv * 100).toFixed(0)}% exceeds cap ${(ltvMax * 100).toFixed(0)}%.`);
    if (m.dscr != null && m.dscr < dscrFloor) flags.push(`${label}: DSCR ${m.dscr.toFixed(2)}x below floor ${dscrFloor.toFixed(2)}x.`);
    if (isJunior) {
      // Junior position: LTV is only complete if we know the senior balance.
      if (p.seniorLienBalance == null) {
        flags.push(`${label}: junior lien (position ${lienPosition}) — senior lien balance not provided; LTV excludes senior debt and UNDERSTATES leverage.`);
      } else {
        flags.push(`${label}: junior lien (position ${lienPosition}) — LTV includes ${Math.round(seniorLien).toLocaleString()} of senior debt.`);
      }
    }
    // Tier-7: a property with no modeled debt service drops out of coverage
    // entirely — make that explicit so it is not read as "covered".
    if (p.annualDebtService == null) {
      flags.push(`${label}: annual debt service not modeled — excluded from coverage (per-property & blended DSCR omit this property).`);
    }
    return m;
  });

  const totalValue = properties.reduce((s, p) => s + p.value, 0);
  const totalLoan = properties.reduce((s, p) => s + p.loanAllocation, 0);
  // Tier-7: senior liens ahead of our loans are real leverage on the collateral;
  // include them so blended LTV mirrors the per-property exposure basis.
  const totalSeniorLien = properties.reduce((s, p) => s + (p.seniorLienBalance ?? 0), 0);
  const anyNoiMissing = perProperty.some((m) => m.noi == null);
  const totalNoi = anyNoiMissing ? null : perProperty.reduce((s, m) => s + (m.noi ?? 0), 0);
  // Tier-7: treating a missing per-property debt service as $0 shrinks the
  // blended denominator and OVERSTATES coverage. Mirror the NOI rule — if ANY
  // property's debt service is unknown, the blended DSCR is not computable.
  const anyDebtServiceMissing = properties.some((p) => p.annualDebtService == null);
  const totalDebtService = properties.reduce((s, p) => s + (p.annualDebtService ?? 0), 0);
  if (anyDebtServiceMissing) {
    flags.push("Blended DSCR not computed — one or more properties have no modeled debt service (treating it as $0 would overstate coverage).");
  }

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
      blendedLtv: div(totalLoan + totalSeniorLien, totalValue),
      blendedDscr:
        totalNoi != null && !anyDebtServiceMissing && totalDebtService > 0
          ? totalNoi / totalDebtService
          : null,
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
