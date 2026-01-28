/**
 * Shared checklist satisfaction logic.
 *
 * Canonical definition of what makes a checklist item "satisfied".
 * Used by readiness, verifyUnderwrite, and deriveLifecycleState.
 */

export type ChecklistItem = {
  status: string | null;
  required?: boolean;
  received_at?: string | null;
  checklist_key?: string | null;
};

/** A checklist item is satisfied if its status is "satisfied" or "received". */
export function isChecklistItemSatisfied(item: ChecklistItem): boolean {
  return item.status === "satisfied" || item.status === "received";
}

/** Filter to only required items that ARE satisfied. */
export function getSatisfiedRequired<T extends ChecklistItem>(items: T[]): T[] {
  return items.filter((i) => i.required && isChecklistItemSatisfied(i));
}

/** Filter to only required items that are NOT satisfied. */
export function getMissingRequired<T extends ChecklistItem>(items: T[]): T[] {
  return items.filter((i) => i.required && !isChecklistItemSatisfied(i));
}
