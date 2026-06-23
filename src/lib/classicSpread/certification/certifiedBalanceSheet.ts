/**
 * SPEC-CLASSIC-SPREAD-BALANCE-SHEET-ACCOUNTING-GATES-1 (Phase 2)
 *
 * Certified balance-sheet totals. Consumes Phase 1 certified DIRECT facts and enforces the
 * accounting identity so an internally-inconsistent balance sheet can never render a
 * certified total:
 *   - Total Liabilities must reconcile to its liability COMPONENTS. If a direct total is
 *     missing, it may be derived (Total Assets − Total Equity) ONLY when there are no material
 *     liability components, OR the derived amount reconciles with the components. Otherwise it
 *     is BLOCKED (never a certified zero).
 *   - The balance identity Assets = Liabilities + Equity is checked once totals are certified.
 *
 * Target defect: OmniCare 2024 has SL_TOTAL_ASSETS = SL_TOTAL_EQUITY = 6,800,000 and no
 * SL_TOTAL_LIABILITIES, so the legacy renderer shows Total Liabilities = 0 while AP 71,364 +
 * Loans-from-Shareholders 1,930,705 + Other Liabilities 284,993 = 2,287,062 are present. That
 * derived 0 is economically false → BLOCKED.
 *
 * Pure (no DB). No reconcileFinancialFacts change. No PDF/schema/route change.
 */

import {
  certifiedDerived,
  certifiedBlocked,
  certifiedUnavailable,
  isRenderable,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";
import { getCertified, type CertifiedSelection } from "./certifyFactSelection";
import { auditRowFromValue, type CertifiedAuditRow } from "./certifiedSpreadAudit";

// A liability total/component is "material" at/above this magnitude.
const MATERIAL_MIN = 1000;

/** Liability line items that, when present and material, the total must reconcile to. */
export const LIABILITY_COMPONENT_KEYS = [
  "SL_ACCOUNTS_PAYABLE",
  "SL_WAGES_PAYABLE",
  "SL_SHORT_TERM_DEBT",
  "SL_OPERATING_CURRENT_LIABILITIES",
  "SL_MORTGAGES_NOTES_BONDS",
  "SL_LOANS_FROM_SHAREHOLDERS",
  "SL_OTHER_LIABILITIES",
] as const;

/** Equity components used to corroborate a direct Total Equity (where available). */
export const EQUITY_COMPONENT_KEYS = ["SL_CAPITAL_STOCK", "SL_RETAINED_EARNINGS"] as const;

export type CertifiedBalanceSheet = {
  period: string;
  totalAssets: CertifiedSpreadValue;
  totalEquity: CertifiedSpreadValue;
  totalLiabilities: CertifiedSpreadValue;
  /** present, certified liability components used in the reconciliation */
  liabilityComponents: { key: string; value: CertifiedSpreadValue }[];
  /** balance-identity outcome once totals are known */
  identity: { status: "ok" | "blocked" | "unavailable"; failureReason: string | null };
  auditRows: CertifiedAuditRow[];
};

/** Tolerance for reconciling two balance-sheet magnitudes (1% of the largest, min $1). */
function reconciles(a: number, b: number, scale: number): boolean {
  const tol = Math.max(1, 0.01 * Math.max(Math.abs(a), Math.abs(b), Math.abs(scale)));
  return Math.abs(a - b) <= tol;
}

export function certifyBalanceSheet(
  selection: CertifiedSelection,
  period: string,
  opts?: { ownerType?: string; ownerEntityId?: string | null },
): CertifiedBalanceSheet {
  const owner = opts?.ownerType;
  const ownerId = opts?.ownerEntityId ?? null;
  const get = (key: string) =>
    owner !== undefined
      ? getCertified(selection, key, period, owner, ownerId)
      : getCertified(selection, key, period);

  const totalAssets = get("SL_TOTAL_ASSETS") ?? certifiedUnavailable("SL_TOTAL_ASSETS not certified for period");

  // Total Equity: prefer a direct SL_TOTAL_EQUITY, else the S-corp retained-earnings proxy.
  const directEquity = get("SL_TOTAL_EQUITY");
  const retainedEarnings = get("SL_RETAINED_EARNINGS");
  const capitalStock = get("SL_CAPITAL_STOCK");
  let totalEquity: CertifiedSpreadValue;
  if (directEquity && isRenderable(directEquity)) {
    // Corroborate against equity components where available — material conflict → caveat (not
    // block; equity proxies legitimately differ, and the liabilities gate is the hard stop).
    const eqComponents = [retainedEarnings, capitalStock].filter(
      (v): v is CertifiedSpreadValue => !!v && isRenderable(v),
    );
    if (eqComponents.length > 0) {
      const compSum = eqComponents.reduce((a, v) => a + (v.value as number), 0);
      if (Math.abs(compSum) >= MATERIAL_MIN && !reconciles(directEquity.value as number, compSum, totalAssets.value ?? 0)) {
        totalEquity = {
          ...directEquity,
          caveats: [
            ...directEquity.caveats,
            `Total Equity ${directEquity.value} does not reconcile with equity components (${EQUITY_COMPONENT_KEYS.join(" + ")} = ${compSum}); verify before committee.`,
          ],
        };
      } else {
        totalEquity = directEquity;
      }
    } else {
      totalEquity = directEquity;
    }
  } else if (retainedEarnings && isRenderable(retainedEarnings)) {
    totalEquity = retainedEarnings;
  } else {
    totalEquity = certifiedUnavailable("Total Equity unavailable (no SL_TOTAL_EQUITY / SL_RETAINED_EARNINGS)");
  }

  // Liability components present + certified.
  const liabilityComponents = LIABILITY_COMPONENT_KEYS.map((key) => ({ key: key as string, value: get(key) }))
    .filter((c): c is { key: string; value: CertifiedSpreadValue } => !!c.value && isRenderable(c.value));
  const componentSum = liabilityComponents.reduce((a, c) => a + (c.value.value as number), 0);
  const hasMaterialComponents = Math.abs(componentSum) >= MATERIAL_MIN;
  const componentTraces = liabilityComponents.map((c) => c.value);

  // Total Liabilities certification.
  const directLiab = get("SL_TOTAL_LIABILITIES");
  let totalLiabilities: CertifiedSpreadValue;

  if (directLiab && isRenderable(directLiab)) {
    if (hasMaterialComponents && !reconciles(directLiab.value as number, componentSum, totalAssets.value ?? 0)) {
      totalLiabilities = certifiedBlocked(
        `Total Liabilities ${directLiab.value} does not reconcile with liability components (sum = ${componentSum}); cannot certify.`,
        [directLiab, ...componentTraces],
      );
    } else {
      totalLiabilities = directLiab;
    }
  } else if (isRenderable(totalAssets) && isRenderable(totalEquity)) {
    const derived = (totalAssets.value as number) - (totalEquity.value as number);
    if (!hasMaterialComponents) {
      // No material liability components — a derived value (including a true 0) is certifiable.
      totalLiabilities = certifiedDerived(derived, "TOTAL_LIABILITIES_FROM_ASSETS_EQUITY", [totalAssets, totalEquity]);
    } else if (reconciles(derived, componentSum, totalAssets.value ?? 0)) {
      totalLiabilities = certifiedDerived(
        derived,
        "TOTAL_LIABILITIES_FROM_ASSETS_EQUITY",
        [totalAssets, totalEquity, ...componentTraces],
      );
    } else {
      // The defining OmniCare 2024 case: derived 0 while components total 2,287,062.
      totalLiabilities = certifiedBlocked(
        `Derived Total Liabilities (Total Assets ${totalAssets.value} − Total Equity ${totalEquity.value} = ${derived}) conflicts with present liability components (sum = ${componentSum}); cannot certify a derived/zero total.`,
        [totalAssets, totalEquity, ...componentTraces],
      );
    }
  } else {
    totalLiabilities = certifiedUnavailable("Total Liabilities unavailable (Total Assets / Total Equity not both certified)");
  }

  // Balance identity: Assets = Liabilities + Equity (only meaningful once all are renderable).
  let identity: CertifiedBalanceSheet["identity"];
  if (totalLiabilities.status === "blocked") {
    identity = { status: "blocked", failureReason: "Total Liabilities blocked — balance identity cannot be certified." };
  } else if (isRenderable(totalAssets) && isRenderable(totalLiabilities) && isRenderable(totalEquity)) {
    const lhs = totalAssets.value as number;
    const rhs = (totalLiabilities.value as number) + (totalEquity.value as number);
    identity = reconciles(lhs, rhs, lhs)
      ? { status: "ok", failureReason: null }
      : { status: "blocked", failureReason: `Balance identity fails: Assets ${lhs} ≠ Liabilities + Equity ${rhs}.` };
  } else {
    identity = { status: "unavailable", failureReason: "Balance identity not evaluable (a total is unavailable)." };
  }

  const auditRows: CertifiedAuditRow[] = [
    auditRowFromValue("balance_sheet", "TOTAL ASSETS", period, totalAssets),
    auditRowFromValue("balance_sheet", "TOTAL LIABILITIES", period, totalLiabilities),
    auditRowFromValue("balance_sheet", "TOTAL NET WORTH", period, totalEquity),
  ];

  return { period, totalAssets, totalEquity, totalLiabilities, liabilityComponents, identity, auditRows };
}
