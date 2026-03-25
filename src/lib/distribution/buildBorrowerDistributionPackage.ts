/**
 * Build borrower-safe distribution package from approved state.
 * Uses plain language, no internal jargon, no policy references.
 * Pure module — no DB, no server-only.
 */

import type { BorrowerDistributionPackage } from "./types";
import type { BorrowerOptionSummary } from "@/lib/structuring/types";

export type BorrowerPackageInput = {
  borrowerName?: string;
  loanPurpose?: string;

  /** Outstanding checklist/document items from the existing portal task model */
  outstandingItems: Array<{
    checklist_key: string;
    title: string;
    description?: string | null;
    required: boolean;
    action_type: "upload" | "answer" | "review" | "contact_bank";
  }>;

  /** Borrower-safe option summaries from 53A.5 */
  optionSummaries?: BorrowerOptionSummary[];

  /** Progress context from existing portal progress model */
  totalExpectedItems: number;
  completedItems: number;
  missingCriticalItems: number;
};

export function buildBorrowerDistributionPackage(
  input: BorrowerPackageInput,
): BorrowerDistributionPackage {
  const name = input.borrowerName ?? "Applicant";
  const progressPct = input.totalExpectedItems > 0
    ? Math.round((input.completedItems / input.totalExpectedItems) * 100)
    : null;

  // Headline
  let headline: string;
  if (input.missingCriticalItems === 0) {
    headline = `${name}, your application is looking great`;
  } else if (input.missingCriticalItems <= 2) {
    headline = `${name}, just a few items left`;
  } else {
    headline = `${name}, let's keep your application moving`;
  }

  // Body
  const bodyParts: string[] = [];
  if (input.loanPurpose) {
    bodyParts.push(`Thank you for your ${input.loanPurpose.toLowerCase()} application.`);
  }
  if (input.missingCriticalItems > 0) {
    bodyParts.push(
      `We need ${input.missingCriticalItems} important item${input.missingCriticalItems > 1 ? "s" : ""} to keep things moving forward.`,
    );
  } else {
    bodyParts.push("We've received the key items we need. We'll let you know if anything else comes up.");
  }
  bodyParts.push("We'll automatically recognize and organize everything you send.");

  // Next steps from outstanding items
  const nextSteps = input.outstandingItems
    .filter((item) => item.required)
    .slice(0, 8)
    .map((item, i) => ({
      id: `step_${i}_${item.checklist_key}`,
      title: item.title,
      description: item.description ?? "Please provide this item at your earliest convenience.",
      action_type: item.action_type,
      checklist_key: item.checklist_key,
    }));

  // Document requests (all outstanding, not just critical)
  const documentRequests = input.outstandingItems
    .filter((item) => item.action_type === "upload")
    .map((item) => ({
      checklist_key: item.checklist_key,
      title: item.title,
      description: item.description ?? null,
      required: item.required,
    }));

  return {
    summary_headline: headline,
    summary_body: bodyParts.join(" "),
    next_steps: nextSteps,
    document_requests: documentRequests,
    option_summaries: input.optionSummaries ?? [],
    safe_progress_context: {
      progress_pct: progressPct,
      expected_count: input.totalExpectedItems,
      missing_critical_count: input.missingCriticalItems,
    },
  };
}
