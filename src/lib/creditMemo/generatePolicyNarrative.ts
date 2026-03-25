/**
 * Credit memo policy narrative generation.
 * Produces structured explanation text from deal state, policy, and decisions.
 * Pure module — no DB, no server-only.
 */

import type { CollateralLtvSummary } from "@/lib/builder/collateralLtv";
import type { PolicyException } from "@/lib/policy/policyExceptions";

// ── Types ────────────────────────────────────────────────────────

export type PolicyNarrativeInput = {
  // Collateral
  collateralItems: Array<{
    description: string;
    itemType: string;
    estimatedValue: number;
    advanceRate: number;
    lendableValue: number;
    valuationMethod?: string;
    policySource: string;
    policyReference?: string | null;
  }>;
  ltv: CollateralLtvSummary;
  requestedAmount: number;

  // Equity
  equityRequiredPct?: number | null;
  equityActualPct?: number | null;
  equityActualAmount?: number | null;
  equitySource?: string | null;
  equityPolicySource?: string | null;
  equityPolicyReference?: string | null;

  // Ownership
  owners: Array<{
    name: string;
    ownershipPct?: number;
    source: string;
    confirmed: boolean;
  }>;

  // Exceptions
  exceptions: PolicyException[];
};

export type PolicyNarrative = {
  collateral_analysis: string;
  equity_analysis: string;
  ownership_analysis: string;
  exceptions_summary: string;
};

// ── Generator ────────────────────────────────────────────────────

export function generatePolicyNarrative(input: PolicyNarrativeInput): PolicyNarrative {
  return {
    collateral_analysis: generateCollateralNarrative(input),
    equity_analysis: generateEquityNarrative(input),
    ownership_analysis: generateOwnershipNarrative(input),
    exceptions_summary: generateExceptionsSummary(input.exceptions),
  };
}

// ── Collateral ───────────────────────────────────────────────────

function generateCollateralNarrative(input: PolicyNarrativeInput): string {
  const items = input.collateralItems;
  if (items.length === 0) {
    return "No collateral has been pledged for this transaction.";
  }

  const parts: string[] = [];

  if (items.length === 1) {
    const c = items[0];
    parts.push(
      `The loan is secured by ${c.description || c.itemType} with an estimated value of $${c.estimatedValue.toLocaleString()}.`,
    );
    if (c.valuationMethod) {
      parts.push(`Valuation is based on ${formatValuationMethod(c.valuationMethod)}.`);
    }
    const refText = c.policyReference ? ` (${c.policyReference})` : "";
    parts.push(
      `Per ${c.policySource}${refText}, ${c.itemType} is advanced at ${Math.round(c.advanceRate * 100)}%, resulting in a lendable value of $${c.lendableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`,
    );
  } else {
    parts.push(
      `The loan is secured by ${items.length} collateral items with a total estimated value of $${input.ltv.totalGrossValue.toLocaleString()}.`,
    );
    for (const c of items) {
      parts.push(
        `${c.description || c.itemType}: $${c.estimatedValue.toLocaleString()} at ${Math.round(c.advanceRate * 100)}% advance rate = $${c.lendableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} lendable (${c.policySource}).`,
      );
    }
  }

  if (input.ltv.ltv != null) {
    parts.push(
      `The requested loan of $${input.requestedAmount.toLocaleString()} results in an LTV of ${(input.ltv.ltv * 100).toFixed(1)}%.`,
    );
    if (input.ltv.policyLimit != null) {
      if (input.ltv.withinPolicy) {
        parts.push(`This is within the policy limit of ${(input.ltv.policyLimit * 100).toFixed(0)}%.`);
      } else {
        parts.push(`This exceeds the policy limit of ${(input.ltv.policyLimit * 100).toFixed(0)}%.`);
      }
    }
  }

  return parts.join(" ");
}

// ── Equity ───────────────────────────────────────────────────────

function generateEquityNarrative(input: PolicyNarrativeInput): string {
  if (input.equityRequiredPct == null && input.equityActualPct == null) {
    return "No equity injection requirement has been established for this transaction.";
  }

  const parts: string[] = [];

  if (input.equityRequiredPct != null) {
    const sourceText = input.equityPolicySource ?? "policy";
    const refText = input.equityPolicyReference ? ` (${input.equityPolicyReference})` : "";
    parts.push(
      `The transaction requires a minimum equity injection of ${(input.equityRequiredPct * 100).toFixed(0)}% per ${sourceText}${refText}.`,
    );
  }

  if (input.equityActualPct != null) {
    parts.push(
      `The borrower has proposed ${(input.equityActualPct * 100).toFixed(0)}%`,
    );
    if (input.equityActualAmount != null) {
      parts[parts.length - 1] += ` ($${input.equityActualAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })})`;
    }
    parts[parts.length - 1] += ".";

    if (input.equityRequiredPct != null) {
      if (input.equityActualPct >= input.equityRequiredPct) {
        parts.push("This meets the minimum equity requirement.");
      } else {
        const shortfall = input.equityRequiredPct - input.equityActualPct;
        parts.push(
          `This results in a shortfall of ${(shortfall * 100).toFixed(0)}%.`,
        );
      }
    }
  }

  if (input.equitySource) {
    parts.push(`Source of equity: ${input.equitySource}.`);
  }

  return parts.join(" ");
}

// ── Ownership ────────────────────────────────────────────────────

function generateOwnershipNarrative(input: PolicyNarrativeInput): string {
  if (input.owners.length === 0) {
    return "No ownership information has been established.";
  }

  const parts: string[] = [];
  for (const o of input.owners) {
    const pctText = o.ownershipPct != null ? ` (${o.ownershipPct}% ownership)` : "";
    const confirmText = o.confirmed ? ", confirmed by banker" : "";
    parts.push(`${o.name}${pctText} — sourced from ${o.source}${confirmText}.`);
  }

  return parts.join(" ");
}

// ── Exceptions ───────────────────────────────────────────────────

function generateExceptionsSummary(exceptions: PolicyException[]): string {
  if (exceptions.length === 0) {
    return "No policy exceptions noted.";
  }

  const items = exceptions.map((e) => `- ${e.description}`);
  return `Policy exceptions (${exceptions.length}):\n${items.join("\n")}`;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatValuationMethod(method: string): string {
  const labels: Record<string, string> = {
    appraisal: "a formal appraisal",
    management_stated_value: "management's stated value",
    purchase_price: "purchase price",
    broker_opinion: "a broker opinion of value",
    book_value: "book value",
    tax_assessment: "tax assessment",
    liquidation_estimate: "a liquidation estimate",
  };
  return labels[method] ?? method;
}
