/**
 * Phase 65E — Primary Action → NextStep Adapter
 *
 * Maps canonical primaryAction to a NextStepCandidate for convergence
 * with the existing getDealNextStep routing system.
 *
 * Pure function — no DB, no side effects.
 */

import type { BuddyNextAction } from "@/core/actions/types";

export type NextStepCandidate = {
  label: string;
  href: string;
  reason: string;
  priority: "immediate" | "soon" | "later";
  domain:
    | "borrower"
    | "documents"
    | "underwrite"
    | "pricing"
    | "memo"
    | "committee"
    | "servicing";
} | null;

const ACTION_TO_DOMAIN: Partial<
  Record<string, { domain: NextStepCandidate & object extends null ? never : NonNullable<NextStepCandidate>["domain"]; hrefSuffix: string }>
> = {
  request_documents:           { domain: "documents",  hrefSuffix: "/documents" },
  review_uploaded_documents:   { domain: "documents",  hrefSuffix: "/documents" },
  finalize_document_classification: { domain: "documents", hrefSuffix: "/documents" },
  set_pricing_assumptions:     { domain: "pricing",    hrefSuffix: "/pricing" },
  run_extraction:              { domain: "underwrite", hrefSuffix: "/spreads/standard" },
  generate_financial_snapshot: { domain: "underwrite", hrefSuffix: "/spreads/standard" },
  finalize_risk_pricing:       { domain: "pricing",    hrefSuffix: "/pricing" },
  complete_structural_pricing: { domain: "pricing",    hrefSuffix: "/pricing" },
  commit_pricing_quote:        { domain: "pricing",    hrefSuffix: "/pricing" },
  review_credit_memo:          { domain: "memo",       hrefSuffix: "/memo" },
  generate_committee_packet:   { domain: "committee",  hrefSuffix: "/committee" },
  record_committee_decision:   { domain: "committee",  hrefSuffix: "/committee" },
  start_closing:               { domain: "servicing",  hrefSuffix: "/closing" },
  complete_closing:            { domain: "servicing",  hrefSuffix: "/closing" },
};

const PRIORITY_MAP: Record<string, "immediate" | "soon" | "later"> = {
  critical: "immediate",
  high: "soon",
  normal: "later",
};

export function mapPrimaryActionToNextStepCandidate(
  dealId: string,
  primaryAction: BuddyNextAction | null,
): NextStepCandidate {
  if (!primaryAction) return null;

  const mapping = ACTION_TO_DOMAIN[primaryAction.code];
  if (!mapping) return null;

  return {
    label: primaryAction.label,
    href: `/deals/${dealId}${mapping.hrefSuffix}`,
    reason: primaryAction.description,
    priority: PRIORITY_MAP[primaryAction.priority] ?? "later",
    domain: mapping.domain,
  };
}
