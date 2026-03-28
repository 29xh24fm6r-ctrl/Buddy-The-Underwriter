/**
 * Phase 65I — Compute Next Due Date
 *
 * Pure function. Calculates the next due date for a monitoring obligation
 * based on cadence, due_day, due_month, and reference date.
 */

import type { MonitoringCadence } from "@/core/post-close/types";

export function computeNextDueDate(
  cadence: MonitoringCadence,
  referenceDate: Date,
  dueDay: number | null,
  dueMonth: number | null,
): Date {
  const day = dueDay ?? 1;
  const now = referenceDate;

  switch (cadence) {
    case "monthly": {
      // Next month's due day
      const next = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return next <= now
        ? new Date(now.getFullYear(), now.getMonth() + 2, day)
        : next;
    }

    case "quarterly": {
      // Next quarter end + due day offset
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const nextQuarterMonth = (currentQuarter + 1) * 3;
      const next = new Date(now.getFullYear(), nextQuarterMonth, day);
      return next <= now
        ? new Date(now.getFullYear(), nextQuarterMonth + 3, day)
        : next;
    }

    case "semi_annual": {
      // Every 6 months from due_month
      const baseMonth = dueMonth != null ? dueMonth - 1 : 0;
      const candidate1 = new Date(now.getFullYear(), baseMonth, day);
      const candidate2 = new Date(now.getFullYear(), baseMonth + 6, day);
      const candidate3 = new Date(now.getFullYear() + 1, baseMonth, day);

      if (candidate1 > now) return candidate1;
      if (candidate2 > now) return candidate2;
      return candidate3;
    }

    case "annual": {
      const month = dueMonth != null ? dueMonth - 1 : 0;
      const thisYear = new Date(now.getFullYear(), month, day);
      return thisYear > now
        ? thisYear
        : new Date(now.getFullYear() + 1, month, day);
    }

    case "one_time": {
      // One-time obligations use a 30-day default from reference
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    case "custom":
    default: {
      // Custom: default to 90 days from reference
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    }
  }
}

/**
 * Generate all due dates within a lookahead window.
 */
export function generateDueDatesInWindow(
  cadence: MonitoringCadence,
  windowStart: Date,
  windowEnd: Date,
  dueDay: number | null,
  dueMonth: number | null,
): Date[] {
  if (cadence === "one_time") {
    const d = computeNextDueDate(cadence, windowStart, dueDay, dueMonth);
    return d <= windowEnd ? [d] : [];
  }

  const dates: Date[] = [];
  let cursor = new Date(windowStart);
  const MAX_ITERATIONS = 24; // Safety cap

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = computeNextDueDate(cadence, cursor, dueDay, dueMonth);
    if (next > windowEnd) break;
    dates.push(next);
    // Advance cursor past this due date
    cursor = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }

  return dates;
}
