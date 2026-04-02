/**
 * Noise Suppression — Phase 66C
 *
 * Filters out low-value noise from display to keep
 * banker and borrower experiences focused on high-signal items.
 * Pure function, no DB or server deps.
 */

type BankerItem = {
  confidence?: string;
  priorityScore: number;
  overrideRate?: number;
};

type BorrowerItem = {
  confidence?: string;
  priorityScore: number;
  confusionRate?: number;
};

/**
 * Suppress low-value items from the banker view.
 *
 * Suppress if:
 * - confidence is "low" AND priority < 25
 * - OR overrideRate > 0.5 (bankers override this more than half the time)
 */
export function shouldSuppressForBanker(item: BankerItem): boolean {
  if (item.confidence === "low" && item.priorityScore < 25) return true;
  if (item.overrideRate != null && item.overrideRate > 0.5) return true;
  return false;
}

/**
 * Suppress confusing or low-value items from the borrower view.
 *
 * Suppress if:
 * - confusionRate > 0.3
 * - OR confidence is "low" AND priority < 30
 */
export function shouldSuppressForBorrower(item: BorrowerItem): boolean {
  if (item.confusionRate != null && item.confusionRate > 0.3) return true;
  if (item.confidence === "low" && item.priorityScore < 30) return true;
  return false;
}

/**
 * Filters an array of items, removing noise for the given audience.
 */
export function filterNoise<T extends { priorityScore: number }>(
  items: T[],
  isBorrower: boolean,
): T[] {
  return items.filter((item) => {
    if (isBorrower) {
      return !shouldSuppressForBorrower(item as unknown as BorrowerItem);
    }
    return !shouldSuppressForBanker(item as unknown as BankerItem);
  });
}
