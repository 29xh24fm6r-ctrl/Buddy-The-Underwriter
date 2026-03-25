/**
 * Queue banker outreach from approved distribution package.
 * Uses draft-first / approval-aware workflow pattern.
 * Pure module — no DB, no server-only.
 */

import type { BankerDistributionPackage } from "./types";

export type OutreachDraftStatus = "draft" | "approved" | "sent";

export type BankerOutreachDraft = {
  draft_id: string;
  status: OutreachDraftStatus;
  cover_message: string;
  items: Array<{
    type: "question" | "document_request";
    title: string;
    description: string | null;
  }>;
  approved_structure_summary: string;
  created_at: string;
};

/**
 * Convert a banker distribution package into a draft outreach package.
 * Draft must be explicitly approved before it can be sent.
 */
export function createOutreachDraftFromBankerPackage(
  pkg: BankerDistributionPackage,
  dealId: string,
): BankerOutreachDraft {
  return {
    draft_id: `outreach_${dealId}_${Date.now()}`,
    status: "draft",
    cover_message: pkg.borrower_outreach_cover_message,
    items: pkg.send_package_items,
    approved_structure_summary: pkg.approved_structure_summary,
    created_at: new Date().toISOString(),
  };
}

/**
 * Validate that a draft is ready to be approved for sending.
 */
export function validateOutreachDraftForApproval(
  draft: BankerOutreachDraft,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!draft.cover_message.trim()) {
    issues.push("Cover message is empty");
  }
  if (draft.items.length === 0) {
    issues.push("No items to send to borrower");
  }

  return { valid: issues.length === 0, issues };
}
