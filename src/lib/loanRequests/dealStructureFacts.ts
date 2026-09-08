/**
 * Deal-structure facts (loan request + collateral + sources/uses) — pure.
 *
 * The credit-memo readiness adapter requires BANK_LOAN_TOTAL, TOTAL_PROJECT_COST,
 * BORROWER_EQUITY(_PCT), COLLATERAL GROSS / NET / DISCOUNTED value, LTV gross /
 * net and discounted coverage. Until now only the manual underwriting-synthesis
 * route computed the collateral and project-cost figures, so every deal driven
 * by the automatic spread chain sat at memo status "partial" with net LTV
 * "Pending" even when the loan request and collateral schedule were complete.
 *
 * This module derives the whole set from the latest loan request, the
 * collateral schedule and any proceeds items, using the same advance-rate
 * policy as the synthesis route (computeCollateralFactValues).
 */

import {
  computeCollateralFactValues,
  type CollateralInput,
} from "@/lib/underwritingSynthesis/computePure";

/**
 * Fact addressing for the keys this module writes. Mirrors CANONICAL_FACTS in
 * lib/financialFacts/keys.ts (which imports "server-only" and therefore cannot
 * be pulled into this pure module or its node:test suite).
 */
export const DEAL_STRUCTURE_FACT_ADDRESSES = {
  BANK_LOAN_TOTAL: { fact_type: "SOURCES_USES", fact_key: "BANK_LOAN_TOTAL" },
  TOTAL_PROJECT_COST: { fact_type: "SOURCES_USES", fact_key: "TOTAL_PROJECT_COST" },
  BORROWER_EQUITY: { fact_type: "SOURCES_USES", fact_key: "BORROWER_EQUITY" },
  BORROWER_EQUITY_PCT: { fact_type: "SOURCES_USES", fact_key: "BORROWER_EQUITY_PCT" },
  COLLATERAL_GROSS_VALUE: { fact_type: "COLLATERAL", fact_key: "GROSS_VALUE" },
  COLLATERAL_NET_VALUE: { fact_type: "COLLATERAL", fact_key: "NET_VALUE" },
  COLLATERAL_DISCOUNTED_VALUE: { fact_type: "COLLATERAL", fact_key: "DISCOUNTED_VALUE" },
  COLLATERAL_DISCOUNTED_COVERAGE: { fact_type: "COLLATERAL", fact_key: "DISCOUNTED_COVERAGE" },
  LTV_GROSS: { fact_type: "COLLATERAL", fact_key: "LTV_GROSS" },
  LTV_NET: { fact_type: "COLLATERAL", fact_key: "LTV_NET" },
} as const;

export type DealStructureFactKey = keyof typeof DEAL_STRUCTURE_FACT_ADDRESSES;

export type DealStructureLoanRequest = {
  requested_amount?: number | null;
  approved_amount?: number | null;
  property_value?: number | null;
  purchase_price?: number | null;
  down_payment?: number | null;
  total_project_cost?: number | null;
};

export type DealStructureFactWrite = {
  canonicalKey: DealStructureFactKey;
  factType: string;
  factKey: string;
  value: number;
  label: string;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function push(
  out: DealStructureFactWrite[],
  canonicalKey: DealStructureFactKey,
  value: number | null | undefined,
  label: string,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  const def = DEAL_STRUCTURE_FACT_ADDRESSES[canonicalKey];
  out.push({ canonicalKey, factType: def.fact_type, factKey: def.fact_key, value, label });
}

export function computeDealStructureFacts(input: {
  loanRequest: DealStructureLoanRequest | null;
  collateral: CollateralInput[];
  /** Sum of deal_proceeds_items.amount, when the deal has a sources & uses schedule. */
  proceedsTotal: number | null;
}): { writes: DealStructureFactWrite[]; notes: string[] } {
  const writes: DealStructureFactWrite[] = [];
  const notes: string[] = [];
  const lr = input.loanRequest;

  const loanAmount = num(lr?.requested_amount) ?? num(lr?.approved_amount);
  if (loanAmount === null || loanAmount <= 0) {
    notes.push("no_loan_request_amount");
    return { writes, notes };
  }
  push(writes, "BANK_LOAN_TOTAL", loanAmount, `Loan amount: ${loanAmount}`);

  // ── Sources & uses ──────────────────────────────────────────────────────
  const downPayment = num(lr?.down_payment);
  const totalProjectCost =
    num(lr?.total_project_cost) ??
    (input.proceedsTotal !== null && input.proceedsTotal > 0 ? input.proceedsTotal : null) ??
    num(lr?.purchase_price) ??
    (downPayment !== null && downPayment > 0 ? loanAmount + downPayment : null);
  if (totalProjectCost !== null && totalProjectCost > 0) {
    push(writes, "TOTAL_PROJECT_COST", totalProjectCost, `Total project cost: ${totalProjectCost}`);
    const equity =
      downPayment !== null && downPayment > 0 ? downPayment : Math.max(0, totalProjectCost - loanAmount);
    push(writes, "BORROWER_EQUITY", equity, `Borrower equity: ${equity}`);
    push(writes, "BORROWER_EQUITY_PCT", equity / totalProjectCost, `Borrower equity %: ${equity}/${totalProjectCost}`);
  } else {
    if (downPayment !== null && downPayment > 0) {
      push(writes, "BORROWER_EQUITY", downPayment, `Down payment: ${downPayment}`);
    }
    notes.push("no_total_project_cost");
  }

  // ── Collateral ─────────────────────────────────────────────────────────
  // The collateral schedule is authoritative; fall back to the request's
  // property value so a CRE deal without a schedule still carries gross value.
  const items = input.collateral.filter((c) => (num(c.estimated_value) ?? 0) > 0);
  if (items.length > 0) {
    const coll = computeCollateralFactValues({ collateral: items, bankLoanTotal: loanAmount });
    push(writes, "COLLATERAL_GROSS_VALUE", coll.facts.COLLATERAL_GROSS_VALUE, "Collateral schedule: gross value");
    push(writes, "COLLATERAL_NET_VALUE", coll.facts.COLLATERAL_NET_VALUE, "Collateral schedule: net lendable (advance rate)");
    push(writes, "COLLATERAL_DISCOUNTED_VALUE", coll.facts.COLLATERAL_DISCOUNTED_VALUE, "Collateral schedule: discounted value");
    push(writes, "COLLATERAL_DISCOUNTED_COVERAGE", coll.facts.COLLATERAL_DISCOUNTED_COVERAGE, "Discounted collateral / loan");
    push(writes, "LTV_GROSS", coll.facts.LTV_GROSS, "Loan / gross collateral");
    push(writes, "LTV_NET", coll.facts.LTV_NET, "Loan / net collateral");
    for (const m of coll.missing) notes.push(`${m.factKey}:${m.reason}`);
  } else {
    const propertyValue = num(lr?.property_value) ?? num(lr?.purchase_price);
    if (propertyValue !== null && propertyValue > 0) {
      push(writes, "COLLATERAL_GROSS_VALUE", propertyValue, `Collateral value: ${propertyValue}`);
      push(writes, "LTV_GROSS", loanAmount / propertyValue, "Loan / property value");
      notes.push("no_collateral_schedule:net_values_unavailable");
    } else {
      notes.push("no_collateral");
    }
  }

  return { writes, notes };
}
