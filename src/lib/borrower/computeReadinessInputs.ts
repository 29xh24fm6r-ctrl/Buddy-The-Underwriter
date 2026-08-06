import type { BorrowerCompleteness } from "@/lib/borrower/borrowerCompleteness";
import {
  classifyGroup,
  type BorrowerDocumentStatus,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import {
  deriveBorrowerDocStatus,
  normalizeChecklistKey,
  type MinimalDoc,
} from "@/lib/portal/deriveBorrowerDocStatus";

/**
 * Pure computation layer for /api/portal/[token]/readiness-inputs.
 *
 * Extracted out of the route handler so the ownership partial-credit math
 * and the SBA-forms counting can be unit-tested directly against fixture
 * data, without a live Supabase connection. The route handler's only job
 * is fetching rows and handing them to these functions unchanged.
 */

export const OWNERSHIP_CONDITION_KEYS = [
  "owner_gte_20pct",
  "total_ownership_gte_80pct",
  "owner_attestation",
] as const;

export type OwnershipReadiness = {
  hasSignificantOwner: boolean;
  totalDocumentedPct: number;
  hasAttestation: boolean;
  conditionsSatisfied: number;
  conditionsRequired: number;
  gateComplete: boolean;
  /** True only when total ownership is >= 80% and < 100% — independent of
   *  gateComplete, per the approved correction: a missing attestation or
   *  missing significant-owner condition must never be mislabeled as an
   *  ownership-percentage clarification. */
  clarificationNeeded: boolean;
};

export function computeOwnershipReadiness(
  completeness: Pick<BorrowerCompleteness, "missing" | "stats">,
): OwnershipReadiness {
  const conditionsRequired = OWNERSHIP_CONDITION_KEYS.length;
  const conditionsSatisfied =
    conditionsRequired -
    OWNERSHIP_CONDITION_KEYS.filter((k) => completeness.missing.includes(k)).length;
  const gateComplete = conditionsSatisfied === conditionsRequired;

  const totalDocumentedPct = completeness.stats.total_ownership_pct;
  const clarificationNeeded = totalDocumentedPct >= 80 && totalDocumentedPct < 100;

  return {
    hasSignificantOwner: completeness.stats.has_significant_owner,
    totalDocumentedPct,
    hasAttestation: completeness.stats.has_attestation,
    conditionsSatisfied,
    conditionsRequired,
    gateComplete,
    clarificationNeeded,
  };
}

export type ChecklistRow = {
  item: {
    title: string;
    group_name: string;
    required: boolean;
    code: string;
  };
  state: {
    status: string;
  };
};

export type SbaFormsReadiness = {
  applicable: boolean;
  required: number;
  accepted: number;
  underReview: number;
  needsAttention: number;
  notApplicableReason: string | null;
};

const UNDER_REVIEW_STATUSES = new Set<BorrowerDocumentStatus>([
  "uploaded",
  "received",
  "reviewing",
]);

export function computeSbaFormsReadiness(
  checklistRows: ChecklistRow[],
  uploadRows: Array<{ checklist_key: string | null; status: string | null }>,
): SbaFormsReadiness {
  const docsByChecklistKey = new Map<string, MinimalDoc[]>();
  for (const row of uploadRows) {
    const key = normalizeChecklistKey(row.checklist_key);
    if (!key) continue;
    const list = docsByChecklistKey.get(key) ?? [];
    list.push({ status: String(row.status ?? "") });
    docsByChecklistKey.set(key, list);
  }

  let required = 0;
  let accepted = 0;
  let underReview = 0;
  let needsAttention = 0;

  for (const row of checklistRows) {
    const group = classifyGroup(row.item.title, row.item.group_name);
    if (group !== "sba_forms") continue;
    if (!row.item.required) continue;

    const checklistKey = normalizeChecklistKey(row.item.code || row.item.title);
    const relatedDocs = docsByChecklistKey.get(checklistKey) ?? [];
    const status = deriveBorrowerDocStatus({
      checklistStatus: row.state.status,
      docs: relatedDocs,
      required: row.item.required,
    });

    required += 1;
    if (status === "accepted") {
      accepted += 1;
    } else if (UNDER_REVIEW_STATUSES.has(status)) {
      underReview += 1;
    } else if (status === "needs_attention") {
      needsAttention += 1;
    }
  }

  const applicable = required > 0;

  return {
    applicable,
    required,
    accepted,
    underReview,
    needsAttention,
    notApplicableReason: applicable ? null : "not_required_for_deal",
  };
}
