/**
 * Publish borrower distribution package into the existing portal flow.
 * Maps BorrowerDistributionPackage into the portal-safe consumable payload
 * without exposing internal-only fields.
 * Pure module — no DB, no server-only.
 */

import type { BorrowerDistributionPackage } from "./types";

/**
 * Portal-safe payload shape compatible with existing borrower portal requests API.
 */
export type PortalPublicationPayload = {
  headline: string;
  body: string;
  requests: Array<{
    id: string;
    title: string;
    description: string;
    type: "upload" | "answer" | "review" | "contact_bank";
    required: boolean;
    checklist_key?: string | null;
  }>;
  progress: {
    pct: number | null;
    total: number | null;
    remaining: number | null;
  };
};

/**
 * Convert a BorrowerDistributionPackage into a portal-safe payload.
 * Strips any internal-only fields and ensures borrower-safe language.
 */
export function mapBorrowerPackageToPortalPayload(
  pkg: BorrowerDistributionPackage,
): PortalPublicationPayload {
  const requests = [
    // Next steps as requests
    ...pkg.next_steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      type: step.action_type,
      required: true,
      checklist_key: step.checklist_key,
    })),
    // Document requests that aren't already in next steps
    ...pkg.document_requests
      .filter((dr) => !pkg.next_steps.some((s) => s.checklist_key === dr.checklist_key))
      .map((dr, i) => ({
        id: `doc_${i}_${dr.checklist_key}`,
        title: dr.title,
        description: dr.description ?? "Please upload this document.",
        type: "upload" as const,
        required: dr.required,
        checklist_key: dr.checklist_key,
      })),
  ];

  return {
    headline: pkg.summary_headline,
    body: pkg.summary_body,
    requests,
    progress: {
      pct: pkg.safe_progress_context.progress_pct,
      total: pkg.safe_progress_context.expected_count,
      remaining: pkg.safe_progress_context.missing_critical_count,
    },
  };
}
