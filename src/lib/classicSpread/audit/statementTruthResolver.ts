/**
 * SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1 — statement-level truth resolver (pure).
 *
 * Sits between extracted facts and rendered spread rows. Per period it receives candidate facts
 * and arbitrates the coherent total for each statement row, emitting findings (rejected/suspect
 * source values, contradictory components, missing implied components, formula mismatches). No IO.
 *
 * The resolver is the source of truth the Spread Accuracy Audit uses — it does not mutate rendered
 * rows; it explains which candidate value is trustworthy and which is rejected/suspect, so a banker
 * can confirm before the spread is considered clean.
 */

import type { PeriodMaps } from "../classicSpreadRatios";

export type Facts = Record<string, number | null>;

export type CellBasis =
  | "direct"
  | "component_sum"
  | "balancing"
  | "retained_earnings"
  | "derived"
  | "unavailable";

export type ResolvedCell = { value: number | null; basis: CellBasis };

export type ResolverIssueType =
  | "contradictory_components"
  | "missing_implied_component"
  | "formula_mismatch"
  | "rejected_source_value"
  | "unreconciled_total";

export type ResolverFinding = {
  rowLabel: string;
  issueType: ResolverIssueType;
  expectedValue: number | null;
  actualValue: number | null;
  difference: number | null;
  severity: "blocker" | "warning" | "info";
  detail: string;
  rejectedSource?: { key: string; value: number };
};

export type ResolvedBalanceSheet = {
  totalAssets: ResolvedCell;
  totalCurrentAssets: ResolvedCell;
  totalNonCurrentAssets: ResolvedCell;
  totalCurrentLiabilities: ResolvedCell;
  totalNonCurrentLiabilities: ResolvedCell;
  totalLiabilities: ResolvedCell;
  totalEquity: ResolvedCell;
  totalLiabilitiesAndEquity: ResolvedCell;
  findings: ResolverFinding[];
};

export type ResolvedIncomeStatement = {
  revenue: ResolvedCell;
  grossProfit: ResolvedCell;
  findings: ResolverFinding[];
};

// ── helpers ───────────────────────────────────────────────────────────────────

function tol(x: number | null): number {
  return Math.max(1, Math.round(0.005 * Math.abs(x ?? 0)));
}
function sumPresent(components: (number | null)[]): number | null {
  const present = components.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= tol(b);
}

// ── balance sheet resolver ──────────────────────────────────────────────────

export function resolveBalanceSheet(facts: Facts): ResolvedBalanceSheet {
  const g = (k: string): number | null => facts[k] ?? null;
  const findings: ResolverFinding[] = [];

  const totalAssets = g("SL_TOTAL_ASSETS");

  // --- Current assets ---
  const cash = g("SL_CASH");
  const arGross = g("SL_AR_GROSS");
  const netAr = arGross != null ? arGross - (g("SL_AR_ALLOWANCE") ?? 0) : null;
  const currentComponents = [
    cash, netAr, g("SL_INVENTORY"), g("SL_US_GOV_OBLIGATIONS"),
    g("SL_TAX_EXEMPT_SECURITIES"), g("SL_OTHER_CURRENT_ASSETS"),
  ];
  const componentTCA = sumPresent(currentComponents);
  const directTCA = g("TOTAL_CURRENT_ASSETS") ?? g("SL_TOTAL_CURRENT_ASSETS");

  // --- Non-current assets ---
  const netFixed = (() => {
    const ppe = g("SL_PPE_GROSS");
    if (ppe != null) return ppe - (g("SL_ACCUMULATED_DEPRECIATION") ?? 0);
    return g("SL_NET_FIXED_ASSETS");
  })();
  const intangiblesNet = (() => {
    const ig = g("SL_INTANGIBLES_GROSS");
    return ig != null ? ig - (g("SL_ACCUMULATED_AMORTIZATION") ?? 0) : null;
  })();
  const componentTNCA = sumPresent([
    g("SL_SHAREHOLDER_LOANS_RECEIVABLE"), g("SL_MORTGAGE_LOANS"), g("SL_OTHER_INVESTMENTS"),
    netFixed, g("SL_DEPLETABLE_ASSETS"), g("SL_LAND"), intangiblesNet, g("SL_OTHER_ASSETS"),
  ]);

  // Resolve Total Current Assets — arbitrate direct vs components.
  let totalCurrentAssets: ResolvedCell;
  if (directTCA != null && componentTCA != null && !close(directTCA, componentTCA)) {
    if (directTCA < componentTCA) {
      // Direct TCA omits a present current asset (e.g. equals AR only, excludes cash).
      const reconciled = totalAssets != null && componentTNCA != null ? totalAssets - componentTNCA : componentTCA;
      totalCurrentAssets = { value: reconciled, basis: "component_sum" };
      const equalsArExclCash = netAr != null && close(directTCA, netAr) && cash != null;
      findings.push({
        rowLabel: "TOTAL CURRENT ASSETS",
        issueType: "rejected_source_value",
        expectedValue: reconciled, actualValue: directTCA, difference: directTCA - (reconciled ?? 0),
        severity: "blocker",
        detail: equalsArExclCash
          ? `Direct Total Current Assets (${directTCA}) equals Accounts Receivable only and excludes Cash (${cash}); resolved to component sum ${reconciled}. Requires source confirmation.`
          : `Direct Total Current Assets (${directTCA}) is below the sum of present current-asset components (${componentTCA}); it omits at least one current asset. Resolved to ${reconciled}.`,
        rejectedSource: { key: "SL_TOTAL_CURRENT_ASSETS", value: directTCA },
      });
    } else {
      // Direct TCA exceeds known components → implies a missing current asset (e.g. blank AR).
      const gap = directTCA - (componentTCA ?? 0);
      totalCurrentAssets = { value: directTCA, basis: "direct" };
      findings.push({
        rowLabel: "TOTAL CURRENT ASSETS",
        issueType: "missing_implied_component",
        expectedValue: gap, actualValue: componentTCA, difference: gap,
        severity: "blocker",
        detail: `Direct Total Current Assets (${directTCA}) exceeds the sum of present current-asset components (${componentTCA ?? 0}) by ${gap}, implying a missing current asset (e.g. Accounts Receivable). Requires source confirmation.`,
      });
    }
  } else if (directTCA != null && componentTCA == null) {
    // Only a direct TCA with no components to corroborate — keep it but flag the implied gap.
    totalCurrentAssets = { value: directTCA, basis: "direct" };
    const known = sumPresent(currentComponents) ?? 0;
    if (directTCA - known > tol(directTCA)) {
      findings.push({
        rowLabel: "TOTAL CURRENT ASSETS",
        issueType: "missing_implied_component",
        expectedValue: directTCA - known, actualValue: known, difference: directTCA - known,
        severity: "blocker",
        detail: `Direct Total Current Assets (${directTCA}) has no itemized current-asset components; ${directTCA - known} of current assets is unverified.`,
      });
    }
  } else if (directTCA != null) {
    totalCurrentAssets = { value: directTCA, basis: "direct" };
  } else if (componentTCA != null) {
    totalCurrentAssets = { value: componentTCA, basis: "component_sum" };
  } else {
    totalCurrentAssets = { value: null, basis: "unavailable" };
  }

  // Total Non-Current Assets — components first, else balancing (TA − TCA).
  let totalNonCurrentAssets: ResolvedCell;
  if (componentTNCA != null) {
    totalNonCurrentAssets = { value: componentTNCA, basis: "component_sum" };
  } else if (totalAssets != null && totalCurrentAssets.value != null) {
    totalNonCurrentAssets = { value: totalAssets - totalCurrentAssets.value, basis: "balancing" };
  } else {
    totalNonCurrentAssets = { value: null, basis: "unavailable" };
  }

  // Total Assets — direct first, else TCA + TNCA.
  const totalAssetsCell: ResolvedCell =
    totalAssets != null
      ? { value: totalAssets, basis: "direct" }
      : totalCurrentAssets.value != null && totalNonCurrentAssets.value != null
        ? { value: totalCurrentAssets.value + totalNonCurrentAssets.value, basis: "component_sum" }
        : { value: null, basis: "unavailable" };

  // --- Liabilities ---
  const componentTCL = sumPresent([
    g("SL_ACCOUNTS_PAYABLE"), g("SL_WAGES_PAYABLE"), g("SL_SHORT_TERM_DEBT"), g("SL_OPERATING_CURRENT_LIABILITIES"),
  ]);
  const directTCL = g("TOTAL_CURRENT_LIABILITIES") ?? g("SL_TOTAL_CURRENT_LIABILITIES");
  const totalCurrentLiabilities: ResolvedCell =
    directTCL != null ? { value: directTCL, basis: "direct" }
      : componentTCL != null ? { value: componentTCL, basis: "component_sum" }
        : { value: null, basis: "unavailable" };

  const componentTNCL = sumPresent([
    g("SL_MORTGAGES_NOTES_BONDS"), g("SL_LOANS_FROM_SHAREHOLDERS"), g("SL_OTHER_LIABILITIES"),
  ]);
  const totalNonCurrentLiabilities: ResolvedCell =
    componentTNCL != null ? { value: componentTNCL, basis: "component_sum" } : { value: null, basis: "unavailable" };

  const directTL = g("SL_TOTAL_LIABILITIES");
  const componentTL = componentTCL != null || componentTNCL != null ? (componentTCL ?? 0) + (componentTNCL ?? 0) : null;

  let totalLiabilities: ResolvedCell;
  if (directTL != null && componentTL != null && !close(directTL, componentTL)) {
    // Prefer the component sum; flag the conflict for confirmation.
    totalLiabilities = { value: componentTL, basis: "component_sum" };
    findings.push({
      rowLabel: "TOTAL LIABILITIES", issueType: "contradictory_components",
      expectedValue: componentTL, actualValue: directTL, difference: directTL - componentTL,
      severity: "warning",
      detail: `Direct Total Liabilities (${directTL}) conflicts with the sum of liability components (${componentTL}); resolved to component sum.`,
      rejectedSource: { key: "SL_TOTAL_LIABILITIES", value: directTL },
    });
  } else if (directTL != null) {
    totalLiabilities = { value: directTL, basis: "direct" };
  } else if (componentTL != null) {
    totalLiabilities = { value: componentTL, basis: "component_sum" };
  } else {
    totalLiabilities = { value: null, basis: "unavailable" };
  }

  // --- Equity arbitration (the core 2024 rule) ---
  const directEquity = g("SL_TOTAL_EQUITY");
  const retainedEarnings = g("SL_RETAINED_EARNINGS") ?? g("M2_ENDING_BALANCE") ?? g("SCH_M2_ENDING_BALANCE");
  const taVal = totalAssetsCell.value;
  const tlVal = totalLiabilities.value;
  const impliedEquity = taVal != null && tlVal != null ? taVal - tlVal : null;

  let totalEquity: ResolvedCell;
  if (directEquity != null) {
    const balancesWithDirect = impliedEquity != null && close(directEquity, impliedEquity);
    const reCoherent = retainedEarnings != null && impliedEquity != null && close(retainedEarnings, impliedEquity);
    if (!balancesWithDirect && reCoherent) {
      // RULE: never accept a direct equity that breaks A = L + E when RE/M-2 gives a coherent value.
      totalEquity = { value: retainedEarnings!, basis: "retained_earnings" };
      findings.push({
        rowLabel: "TOTAL NET WORTH", issueType: "rejected_source_value",
        expectedValue: retainedEarnings, actualValue: directEquity, difference: directEquity - retainedEarnings!,
        severity: "blocker",
        detail: `Direct Total Equity (${directEquity}) is rejected: it breaks Assets = Liabilities + Equity (Assets ${taVal} != Liabilities ${tlVal} + ${directEquity}). Retained earnings / M-2 ending balance (${retainedEarnings}) yields a coherent equity that balances. Requires banker/source confirmation.`,
        rejectedSource: { key: "SL_TOTAL_EQUITY", value: directEquity },
      });
    } else if (!balancesWithDirect && impliedEquity != null && retainedEarnings == null) {
      totalEquity = { value: directEquity, basis: "direct" };
      findings.push({
        rowLabel: "TOTAL NET WORTH", issueType: "unreconciled_total",
        expectedValue: impliedEquity, actualValue: directEquity, difference: directEquity - impliedEquity,
        severity: "blocker",
        detail: `Total Equity (${directEquity}) does not balance; Assets − Liabilities implies ${impliedEquity}, and no retained-earnings / M-2 value is available to arbitrate.`,
      });
    } else {
      totalEquity = { value: directEquity, basis: "direct" };
    }
  } else if (retainedEarnings != null) {
    totalEquity = { value: retainedEarnings, basis: "retained_earnings" };
  } else if (impliedEquity != null) {
    totalEquity = { value: impliedEquity, basis: "balancing" };
  } else {
    totalEquity = { value: null, basis: "unavailable" };
  }

  // Liabilities + Equity vs Assets.
  const tlAndEquity: ResolvedCell =
    totalLiabilities.value != null && totalEquity.value != null
      ? { value: totalLiabilities.value + totalEquity.value, basis: "derived" }
      : { value: null, basis: "unavailable" };
  if (taVal != null && tlAndEquity.value != null && !close(tlAndEquity.value, taVal)) {
    findings.push({
      rowLabel: "TOTAL LIABILITIES & NET WORTH", issueType: "unreconciled_total",
      expectedValue: taVal, actualValue: tlAndEquity.value, difference: tlAndEquity.value - taVal,
      severity: "blocker",
      detail: `Resolved Liabilities + Equity (${tlAndEquity.value}) does not equal Total Assets (${taVal}).`,
    });
  }

  return {
    totalAssets: totalAssetsCell,
    totalCurrentAssets,
    totalNonCurrentAssets,
    totalCurrentLiabilities,
    totalNonCurrentLiabilities,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity: tlAndEquity,
    findings,
  };
}

// ── income statement (1120) resolver ────────────────────────────────────────

export function resolveIncomeStatement1120(facts: Facts): ResolvedIncomeStatement {
  const g = (k: string): number | null => facts[k] ?? null;
  const findings: ResolverFinding[] = [];

  // Revenue for gross profit is GROSS RECEIPTS / SALES — NEVER TOTAL_INCOME (line 11, which includes
  // below-the-line income and must not satisfy gross profit).
  const grossReceipts = g("GROSS_RECEIPTS") ?? g("SALES") ?? g("TOTAL_REVENUE");
  const returnsAllowances = g("RETURNS_ALLOWANCES") ?? g("RETURNS_AND_ALLOWANCES");
  const cogs = g("COST_OF_GOODS_SOLD");
  const directGP = g("GROSS_PROFIT");
  const totalIncome = g("TOTAL_INCOME");

  const netReceipts = grossReceipts != null ? grossReceipts - (returnsAllowances ?? 0) : null;
  const computedGP = netReceipts != null ? netReceipts - (cogs ?? 0) : null;

  const revenue: ResolvedCell = grossReceipts != null
    ? { value: netReceipts, basis: returnsAllowances != null ? "derived" : "direct" }
    : { value: null, basis: "unavailable" };

  let grossProfit: ResolvedCell;
  if (directGP != null) {
    if (computedGP != null && !close(directGP, computedGP)) {
      // Conflict not explained by returns/allowances → keep direct but retain a blocker.
      grossProfit = { value: directGP, basis: "direct" };
      findings.push({
        rowLabel: "GROSS PROFIT", issueType: "formula_mismatch",
        expectedValue: computedGP, actualValue: directGP, difference: directGP - computedGP,
        severity: "blocker",
        detail:
          `Direct Gross Profit (${directGP}) conflicts with Revenue${returnsAllowances != null ? " net of returns/allowances" : ""} minus COGS (${computedGP}). ` +
          (returnsAllowances == null
            ? "No returns/allowances line is present to explain the difference — verify the source before relying on it."
            : "The difference is not explained by the reported returns/allowances — verify the source."),
      });
    } else {
      grossProfit = { value: directGP, basis: "direct" };
    }
  } else if (computedGP != null) {
    grossProfit = { value: computedGP, basis: "derived" }; // revenue − COGS when the GP line is missing
  } else {
    grossProfit = { value: null, basis: "unavailable" };
  }

  // TOTAL_INCOME must never satisfy gross profit. If GP is otherwise unresolved but TOTAL_INCOME
  // exists, do NOT borrow it — record that the gross-profit source is missing.
  if (grossProfit.value == null && totalIncome != null) {
    findings.push({
      rowLabel: "GROSS PROFIT", issueType: "formula_mismatch",
      expectedValue: null, actualValue: totalIncome, difference: null,
      severity: "blocker",
      detail: `Gross Profit cannot be sourced from TOTAL_INCOME (${totalIncome}); a gross-receipts/COGS or direct gross-profit source is required.`,
    });
  }

  return { revenue, grossProfit, findings };
}

// ── resolved render overlay (SPEC-CLASSIC-SPREAD-TRUTH-RESOLVER-RENDER-WIRING-1) ──────────────

function factsRecord(m: ReadonlyMap<string, number | null> | undefined): Facts {
  const out: Facts = {};
  if (m) for (const [k, v] of m) out[k] = v;
  return out;
}

/**
 * Build a per-period overlay of `byPeriod` in which a wrong DIRECT total has been CORRECTED to the
 * resolver's arbitrated value, so the rendered Detailed BS / Executive / Ratios / Cash Flow rows
 * reflect resolved truth. Originals are never mutated (the audit keeps the original `byPeriod` to
 * detect and report the rejection). Only a direct fact that the resolver actually overrode is
 * corrected — when the resolver keeps the direct value, the overlay is byte-identical, so deals
 * without conflicts render exactly as before.
 */
export function buildResolvedByPeriod(byPeriod: PeriodMaps, periods: string[]): PeriodMaps {
  const out: PeriodMaps = new Map();
  for (const p of periods) {
    const orig = byPeriod.get(p);
    const clone = new Map<string, number | null>(orig ?? []);
    const facts = factsRecord(orig);
    const bs = resolveBalanceSheet(facts);
    const correct = (key: string, resolved: number | null) => {
      if (resolved == null) return;
      const o = facts[key];
      if (o != null && Math.abs(o - resolved) > tol(resolved)) clone.set(key, resolved);
    };
    // Total equity (e.g. 2024: reject direct 6,800,000 → retained earnings 4,512,938).
    correct("SL_TOTAL_EQUITY", bs.totalEquity.value);
    // Total liabilities (component sum when a direct value conflicts).
    correct("SL_TOTAL_LIABILITIES", bs.totalLiabilities.value);
    // Total current assets (e.g. 2025: reject AR-only direct → 3,133,066). Both key spellings.
    correct("SL_TOTAL_CURRENT_ASSETS", bs.totalCurrentAssets.value);
    correct("TOTAL_CURRENT_ASSETS", bs.totalCurrentAssets.value);
    // Total current liabilities (rare direct-vs-component conflict).
    correct("SL_TOTAL_CURRENT_LIABILITIES", bs.totalCurrentLiabilities.value);
    correct("TOTAL_CURRENT_LIABILITIES", bs.totalCurrentLiabilities.value);
    out.set(p, clone);
  }
  return out;
}
