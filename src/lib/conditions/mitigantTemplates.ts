// src/lib/conditions/mitigantTemplates.ts

export type RequiredDoc = { key: string; label: string; optional?: boolean };

export type ConditionDraft = {
  title: string;
  description?: string | null;
  required_docs: RequiredDoc[];
  borrower_subject: string;
  borrower_body: string;
  default_due_days?: number;
};

const DEFAULTS: Record<string, ConditionDraft> = {
  add_collateral: {
    title: "Provide additional collateral documentation",
    description: "To mitigate policy variance, we need documentation for additional collateral being pledged.",
    required_docs: [
      { key: "collateral_schedule", label: "Collateral schedule / list of pledged assets" },
      { key: "ownership_docs", label: "Proof of ownership for collateral" },
      { key: "valuation_docs", label: "Recent valuation/appraisal (if applicable)", optional: true },
    ],
    borrower_subject: "Additional collateral documentation needed",
    borrower_body:
      "To keep your file moving, please upload documentation for the additional collateral being pledged (collateral schedule, proof of ownership, and any available valuation/appraisal). Once received, we'll confirm how this addresses the policy requirement and proceed.",
    default_due_days: 7,
  },

  reduce_loan_amount: {
    title: "Confirm revised loan structure (reduce loan amount / increase equity)",
    description: "Policy variance can be mitigated by adjusting the structure: reduce loan amount and/or increase equity.",
    required_docs: [
      { key: "sources_uses_update", label: "Updated Sources & Uses reflecting revised structure" },
      { key: "equity_verification", label: "Verification of equity injection / funds", optional: true },
    ],
    borrower_subject: "Updated loan structure confirmation",
    borrower_body:
      "To address a policy requirement, please confirm the revised loan structure (reduced loan amount and/or increased equity). Upload an updated Sources & Uses and any supporting equity verification you have available.",
    default_due_days: 5,
  },

  stronger_guarantor: {
    title: "Provide guarantor support documentation",
    description: "Policy variance can be mitigated by strengthening guarantor support.",
    required_docs: [
      { key: "guarantor_pfs", label: "Guarantor Personal Financial Statement (current)" },
      { key: "guarantor_tax_returns", label: "Guarantor personal tax returns (last 2 years)" },
      { key: "credit_authorization", label: "Credit authorization (if required)", optional: true },
    ],
    borrower_subject: "Guarantor documentation needed",
    borrower_body:
      "To keep underwriting moving, please upload the guarantor's current Personal Financial Statement and the last two years of personal tax returns. This helps us confirm support strength and satisfy policy requirements.",
    default_due_days: 7,
  },

  increase_pricing: {
    title: "Confirm pricing adjustment",
    description: "Policy variance can be mitigated through pricing/yield adjustments subject to approval.",
    required_docs: [
      { key: "pricing_ack", label: "Written acknowledgment of pricing/terms adjustment" },
    ],
    borrower_subject: "Pricing adjustment acknowledgment",
    borrower_body:
      "To address a policy requirement, we may need to adjust pricing/terms. Please provide written acknowledgment that you understand and accept the proposed pricing adjustment so we can finalize the structure.",
    default_due_days: 3,
  },
};

export function draftConditionFromMitigant(mitigant_key: string, mitigant_label: string): ConditionDraft {
  const k = (mitigant_key || "").trim();
  if (DEFAULTS[k]) return DEFAULTS[k];

  return {
    title: mitigant_label || `Mitigant required: ${k}`,
    description: "Policy variance requires mitigation. Please provide the requested documentation or clarification.",
    required_docs: [{ key: "supporting_docs", label: "Supporting documentation / clarification" }],
    borrower_subject: "Additional documentation needed",
    borrower_body:
      "To keep your file moving, please upload supporting documentation or clarification addressing the requested mitigant. Once received, we'll confirm policy compliance and proceed.",
    default_due_days: 7,
  };
}
