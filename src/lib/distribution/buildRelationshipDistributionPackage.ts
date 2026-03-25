/**
 * Build relationship/treasury distribution package.
 * Consumes existing treasury proposal + relationship pricing engine outputs.
 * Pure module — no DB, no server-only.
 */

import type { RelationshipDistributionPackage, TreasuryProposalSummary } from "./types";

export type RelationshipPackageInput = {
  /** Existing treasury proposal engine output */
  treasuryProposals: Array<{
    product: string;
    rationale: string;
    estimated_annual_fee?: number | null;
  }>;

  /** Existing relationship pricing narrative */
  relationshipPricingSummary?: string | null;

  /** Business profile for RM context */
  businessName?: string;
  industry?: string;
  estimatedRevenue?: number | null;
  depositRelationships?: string[];
};

const SECTION_106_NOTE =
  "Relationship pricing considerations are subject to the bank's compliance policies. " +
  "Pricing flexibility, if applicable, must be documented and justified in accordance with " +
  "fair lending requirements and Section 106 of the Riegle Community Development and " +
  "Regulatory Improvement Act. No pricing concession may be offered that cannot be " +
  "independently supported by relationship value, risk profile, or competitive conditions.";

export function buildRelationshipDistributionPackage(
  input: RelationshipPackageInput,
): RelationshipDistributionPackage {
  const proposals: TreasuryProposalSummary[] = input.treasuryProposals.map((p) => ({
    product: p.product,
    rationale: p.rationale,
    estimated_annual_fee: p.estimated_annual_fee,
  }));

  // RM summary
  const rmParts: string[] = [];
  if (input.businessName) {
    rmParts.push(`${input.businessName}`);
    if (input.industry) rmParts[0] += ` (${input.industry})`;
  }
  if (input.estimatedRevenue) {
    rmParts.push(`Estimated revenue: $${input.estimatedRevenue.toLocaleString()}`);
  }
  if (proposals.length > 0) {
    rmParts.push(`${proposals.length} treasury product${proposals.length > 1 ? "s" : ""} recommended based on borrower profile.`);
  }
  if (input.depositRelationships && input.depositRelationships.length > 0) {
    rmParts.push(`Existing deposit relationships: ${input.depositRelationships.join(", ")}.`);
  }
  const totalEstFees = proposals.reduce((sum, p) => sum + (p.estimated_annual_fee ?? 0), 0);
  if (totalEstFees > 0) {
    rmParts.push(`Estimated total annual treasury fee income: $${totalEstFees.toLocaleString()}.`);
  }

  // Borrower-safe summary (optional, no pricing/fee details)
  let borrowerSafe: string | null = null;
  if (proposals.length > 0) {
    borrowerSafe = `Based on your business profile, we may be able to offer ${proposals.length} treasury service${proposals.length > 1 ? "s" : ""} that could streamline your operations and cash management.`;
  }

  return {
    treasury_proposals: proposals,
    relationship_pricing_summary: input.relationshipPricingSummary ?? null,
    rm_summary: rmParts.join(" "),
    borrower_safe_relationship_summary: borrowerSafe,
    compliance_note: SECTION_106_NOTE,
  };
}
