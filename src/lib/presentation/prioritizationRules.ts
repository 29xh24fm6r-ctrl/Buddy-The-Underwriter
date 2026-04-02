/**
 * Filters and prioritizes items for display.
 * Pure function, no DB or server deps.
 */

export type PrioritizationOptions = {
  maxItems?: number; // default 5
  minPriorityScore?: number; // default 20
  suppressLowConfidence?: boolean; // default true
};

const DEFAULTS: Required<PrioritizationOptions> = {
  maxItems: 5,
  minPriorityScore: 20,
  suppressLowConfidence: true,
};

export function shouldSuppress(item: {
  confidence?: string;
  priorityScore?: number;
}): boolean {
  return item.confidence === "low" && (item.priorityScore ?? 0) < 30;
}

export function prioritizeForDisplay<T extends { priorityScore: number }>(
  items: T[],
  options?: PrioritizationOptions,
): T[] {
  const opts = { ...DEFAULTS, ...options };

  let result = items
    .filter((item) => item.priorityScore >= opts.minPriorityScore)
    .filter((item) => {
      if (!opts.suppressLowConfidence) return true;
      return !shouldSuppress(item as T & { confidence?: string });
    });

  result.sort((a, b) => b.priorityScore - a.priorityScore);

  return result.slice(0, opts.maxItems);
}

export function groupByUrgency<T extends { urgencyScore: number }>(
  items: T[],
): { immediate: T[]; soon: T[]; later: T[] } {
  const immediate: T[] = [];
  const soon: T[] = [];
  const later: T[] = [];

  for (const item of items) {
    if (item.urgencyScore >= 70) {
      immediate.push(item);
    } else if (item.urgencyScore >= 40) {
      soon.push(item);
    } else {
      later.push(item);
    }
  }

  return { immediate, soon, later };
}
