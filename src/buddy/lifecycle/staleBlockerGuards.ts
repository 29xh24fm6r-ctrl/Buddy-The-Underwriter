/**
 * Narrow, pure stale-blocker guards for lifecycle derivation.
 *
 * SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1.
 *
 * deriveLifecycleState merges blockers from the cached deal_memo_input_readiness
 * row. That row can lag behind a freshly-repaired checklist (it is rewritten by a
 * different code path), so a stale `unfinalized_required_documents` blocker can be
 * surfaced even though no required checklist row is actually unsatisfied anymore.
 *
 * These helpers let the lifecycle suppress ONLY that specific stale blocker using
 * the checklist rows deriveLifecycleState has ALREADY fetched — no extra query, no
 * readiness recompute. Pure (no IO / server-only) so it is unit-testable.
 */

export type ChecklistRowLite = {
  required?: boolean | null;
  status?: string | null;
};

/** Statuses that count a checklist row as satisfied. */
const SATISFIED_STATUSES = new Set(["received", "waived", "satisfied"]);

/**
 * True when at least one REQUIRED checklist row is still unsatisfied — i.e. an
 * `unfinalized_required_documents` blocker is genuinely live, not stale.
 */
export function hasUnsatisfiedRequiredChecklist(
  checklist: ReadonlyArray<ChecklistRowLite>,
): boolean {
  for (const c of checklist ?? []) {
    if (c?.required === true && !SATISFIED_STATUSES.has(String(c?.status ?? ""))) {
      return true;
    }
  }
  return false;
}

/**
 * Drop a cached `unfinalized_required_documents` memo blocker when the live
 * checklist shows zero required rows still unsatisfied. Every other blocker is
 * left exactly as-is. When required rows ARE still unsatisfied, the blocker is
 * preserved (the gate is real).
 */
export function suppressStaleUnfinalizedDocsBlocker<T extends { code: string }>(
  memoBlockers: ReadonlyArray<T>,
  checklist: ReadonlyArray<ChecklistRowLite>,
): T[] {
  if (hasUnsatisfiedRequiredChecklist(checklist)) {
    return [...memoBlockers];
  }
  return memoBlockers.filter((b) => b.code !== "unfinalized_required_documents");
}
