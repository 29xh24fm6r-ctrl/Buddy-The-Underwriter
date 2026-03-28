/**
 * Phase 65F — Canonical Action → Borrower Plan Mapping
 *
 * Only some canonical actions are borrower-orchestratable.
 * Non-borrower-safe actions return null.
 *
 * Pure function — no DB, no side effects.
 */

import type { BuddyActionCode } from "@/core/actions/types";
import type { BorrowerRequestPlan, BorrowerRequestItem } from "./types";
import { BORROWER_REQUEST_CATALOG } from "./borrowerRequestCatalog";

type BorrowerPlanTemplate = {
  campaignTitle: string;
  defaultItems: string[];
  requiresPortalLink: boolean;
};

/**
 * Maps canonical action codes to borrower campaign templates.
 * null = not borrower-orchestratable.
 */
const ACTION_TO_PLAN: Partial<Record<BuddyActionCode, BorrowerPlanTemplate>> = {
  request_documents: {
    campaignTitle: "Document Request",
    defaultItems: ["upload_general_documents"],
    requiresPortalLink: true,
  },
  resolve_readiness_blockers: {
    campaignTitle: "Readiness Items",
    defaultItems: ["upload_general_documents", "complete_borrower_information"],
    requiresPortalLink: true,
  },
  seed_checklist: {
    campaignTitle: "Application Checklist",
    defaultItems: [
      "upload_tax_returns",
      "upload_financial_statements",
      "upload_pfs",
    ],
    requiresPortalLink: true,
  },
};

/** All action codes that are borrower-orchestratable */
export const BORROWER_ORCHESTRATABLE_ACTIONS = new Set(
  Object.keys(ACTION_TO_PLAN) as BuddyActionCode[],
);

/**
 * Build a borrower request plan from a canonical action code.
 * Returns null if the action is not borrower-safe.
 */
export function buildBorrowerRequestPlan(
  actionCode: BuddyActionCode,
  context?: {
    blockerCodes?: string[];
    checklistKeys?: string[];
    borrowerPhone?: string | null;
    borrowerEmail?: string | null;
  },
): BorrowerRequestPlan | null {
  const template = ACTION_TO_PLAN[actionCode];
  if (!template) return null;

  const items: BorrowerRequestItem[] = template.defaultItems
    .map((key) => {
      const entry = BORROWER_REQUEST_CATALOG[key];
      if (!entry) return null;
      return {
        itemCode: entry.itemCode,
        title: entry.title,
        description: entry.description,
        required: entry.required,
        evidenceType: entry.evidenceType,
      };
    })
    .filter((item): item is BorrowerRequestItem => item !== null);

  // Enrich with checklist keys if available
  if (context?.checklistKeys) {
    for (const key of context.checklistKeys) {
      const catalogEntry = BORROWER_REQUEST_CATALOG[key];
      if (catalogEntry && !items.some((i) => i.itemCode === catalogEntry.itemCode)) {
        items.push({
          itemCode: catalogEntry.itemCode,
          checklistKey: key,
          title: catalogEntry.title,
          description: catalogEntry.description,
          required: catalogEntry.required,
          evidenceType: catalogEntry.evidenceType,
        });
      }
    }
  }

  return {
    actionCode,
    campaignTitle: template.campaignTitle,
    items,
    requiresPortalLink: template.requiresPortalLink,
    canSendSms: !!context?.borrowerPhone,
    canSendEmail: !!context?.borrowerEmail,
  };
}
