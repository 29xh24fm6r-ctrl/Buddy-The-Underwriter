/**
 * Pure mapping: readiness blocker key → navigation target.
 * Used by BuilderRightRail to make readiness items clickable deep links.
 */

import type { BuilderReadinessTarget, BuilderStepKey } from "./builderTypes";

/**
 * Map a readiness blocker key to the builder step, action, and field
 * that the banker should be taken to in order to resolve it.
 */
export function mapBlockerToTarget(blockerKey: string): BuilderReadinessTarget {
  // Strip instance suffix (e.g. "owner_title_missing:uuid" → "owner_title_missing")
  const baseKey = blockerKey.includes(":") ? blockerKey.slice(0, blockerKey.indexOf(":")) : blockerKey;

  switch (baseKey) {
    // Deal / Loan Request
    case "loan_purpose_missing":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "deal.loan_purpose" };
    case "loan_type_missing":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "deal.loan_type" };
    case "requested_amount_missing":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "deal.requested_amount" };

    // Business
    case "entity_name_missing":
      return { step: "loan_request", field_path: "business.legal_entity_name" };
    case "entity_type_missing":
      return { step: "loan_request", field_path: "business.entity_type" };
    case "state_of_formation_missing":
      return { step: "loan_request", field_path: "business.state_of_formation" };
    case "business_address_incomplete":
      return { step: "loan_request", field_path: "business.business_address" };

    // Parties / Owners
    case "owner_missing":
      return { step: "parties", action: "open_owner_drawer" };
    case "owner_name_missing":
      return { step: "parties", action: "open_owner_drawer" };
    case "owner_ownership_pct_missing":
      return { step: "parties", action: "open_owner_drawer" };
    case "owner_title_missing":
      return { step: "parties", action: "open_owner_drawer" };
    case "owner_home_address_missing":
      return { step: "parties", action: "open_owner_drawer" };

    // Guarantors
    case "guarantor_missing":
      return { step: "parties", action: "open_guarantor_drawer" };

    // Collateral
    case "collateral_missing":
      return { step: "collateral", action: "open_collateral_modal" };
    case "collateral_valuation_method_missing":
      return { step: "collateral", action: "open_collateral_modal" };
    case "collateral_advance_rate_missing":
      return { step: "collateral", action: "open_collateral_modal" };

    // Equity
    case "equity_injection_missing":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "structure.equity" };
    case "equity_source_of_funds_missing":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "structure.equity_injection_source" };
    case "equity_below_requirement":
      return { step: "loan_request", action: "open_loan_request_drawer", field_path: "structure.equity" };

    // Financials
    case "financial_snapshot_missing":
      return { step: "financials" };

    // Story
    case "story_incomplete":
      return { step: "story", action: "open_story_prompt_drawer" };

    // Proceeds
    case "proceeds_mismatch":
      return { step: "loan_request" };

    // Fallback
    default:
      return { step: "review" };
  }
}

/**
 * All builder steps with human-readable labels.
 */
export const STEP_LABELS: Record<BuilderStepKey, string> = {
  overview: "Overview",
  parties: "Parties",
  loan_request: "Loan Request",
  financials: "Financials",
  collateral: "Collateral",
  risk: "Risk",
  documents: "Documents",
  story: "Story",
  review: "Review",
};
