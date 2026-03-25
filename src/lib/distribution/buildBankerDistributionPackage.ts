/**
 * Build banker/RM distribution package from approved state.
 * Reuses existing send-package pattern for borrower questions/doc requests.
 * Pure module — no DB, no server-only.
 */

import type { BankerDistributionPackage } from "./types";

export type BankerPackageInput = {
  approvedStructureSummary: string;
  loanAmount?: number;
  loanType?: string;
  borrowerName?: string;

  /** Outstanding borrower questions/doc requests from send-package */
  sendPackageItems: Array<{
    type: "question" | "document_request";
    title: string;
    description?: string | null;
  }>;

  /** From 53A.5 recommendation narrative */
  recommendationSummary?: string | null;

  /** From 53A.4 committee exception narrative */
  exceptionSummary?: string | null;

  /** Banker next actions */
  pendingActions?: string[];
};

export function buildBankerDistributionPackage(
  input: BankerPackageInput,
): BankerDistributionPackage {
  // Cover message for borrower outreach
  const coverParts: string[] = [];
  if (input.borrowerName) {
    coverParts.push(`Dear ${input.borrowerName},`);
  }
  coverParts.push("Thank you for your loan application.");
  if (input.loanAmount) {
    coverParts.push(`We've completed our initial review of your $${input.loanAmount.toLocaleString()} request.`);
  }
  if (input.sendPackageItems.length > 0) {
    coverParts.push(`To move forward, we need ${input.sendPackageItems.length} item${input.sendPackageItems.length > 1 ? "s" : ""} from you.`);
  }
  coverParts.push("Please don't hesitate to reach out with any questions.");

  // Action items
  const actionItems = [...(input.pendingActions ?? [])];
  if (input.sendPackageItems.length > 0) {
    actionItems.push(`Send borrower request package (${input.sendPackageItems.length} items)`);
  }

  return {
    approved_structure_summary: input.approvedStructureSummary,
    borrower_outreach_cover_message: coverParts.join(" "),
    send_package_items: input.sendPackageItems.map((item) => ({
      type: item.type,
      title: item.title,
      description: item.description ?? null,
    })),
    recommendation_summary: input.recommendationSummary ?? null,
    exception_summary: input.exceptionSummary ?? null,
    banker_action_items: actionItems,
  };
}
