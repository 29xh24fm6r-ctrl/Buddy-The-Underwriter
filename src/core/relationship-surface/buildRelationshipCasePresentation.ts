// Pure function. No DB. No side effects. No network.
import type { RelationshipCasePresentation, RelationshipSurfaceCaseRef } from "./types";

/**
 * Convert a case reference into a standardized presentation object.
 * All cases share the same display contract regardless of subsystem.
 */
export function buildRelationshipCasePresentation(
  caseRef: RelationshipSurfaceCaseRef & {
    title?: string;
    summary?: string;
    dueAt?: string | null;
    href?: string | null;
  },
): RelationshipCasePresentation {
  const titleMap: Record<string, string> = {
    annual_review: "Annual Review",
    renewal: "Renewal",
    expansion: "Expansion Opportunity",
    protection: "Relationship Protection",
    crypto_protection: "Crypto Protection",
  };

  const severityMap: Record<string, "normal" | "warning" | "critical"> = {
    open: "normal",
    banker_review_required: "warning",
    ready: "normal",
    borrower_cure_open: "warning",
    in_progress: "normal",
    resolved: "normal",
    stalled: "critical",
    closed: "normal",
    overdue: "critical",
  };

  return {
    caseType: caseRef.caseType,
    status: caseRef.status,
    title: caseRef.title ?? titleMap[caseRef.caseType] ?? "Case",
    summary: caseRef.summary ?? `${titleMap[caseRef.caseType] ?? "Case"} — ${caseRef.status}`,
    ownerUserId: caseRef.ownerUserId,
    openedAt: caseRef.openedAt,
    dueAt: caseRef.dueAt ?? null,
    href: caseRef.href ?? null,
    severity: severityMap[caseRef.status] ?? "normal",
  };
}
