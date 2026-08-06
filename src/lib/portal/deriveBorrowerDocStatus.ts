import type { BorrowerDocumentStatus } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

/**
 * Extracted from PortalClient.tsx (previously a private, client-only local
 * function) so it can be reused server-side by the readiness-inputs endpoint
 * without duplicating the status-derivation logic. Pure function, no
 * behavior change from the original.
 */

export type MinimalDoc = {
  status: string;
};

/**
 * Also extracted from PortalClient.tsx. This is the single normalization
 * used to match a checklist item's code to an uploaded document's
 * checklist_key — server (readiness-inputs) and client (PortalClient) must
 * use the identical function or "which docs belong to this checklist item"
 * could silently disagree between the two.
 */
export function normalizeChecklistKey(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function isInFlightDocStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "pending" || normalized === "processing" || normalized === "received";
}

export function deriveBorrowerDocStatus(params: {
  checklistStatus: string | null | undefined;
  docs: MinimalDoc[];
  required: boolean;
}): BorrowerDocumentStatus {
  const checklist = (params.checklistStatus ?? "missing").toLowerCase();

  if (checklist === "verified") return "accepted";

  const hasInFlight = params.docs.some((doc) => isInFlightDocStatus(doc.status));
  const hasSubmitted = params.docs.some((doc) => {
    const s = doc.status.trim().toLowerCase();
    return s === "submitted" || s === "confirmed" || s === "complete";
  });

  if (checklist === "received") {
    return hasInFlight ? "reviewing" : "received";
  }

  if (hasInFlight) return "uploaded";
  if (hasSubmitted) return "received";

  return params.required ? "missing" : "optional";
}
