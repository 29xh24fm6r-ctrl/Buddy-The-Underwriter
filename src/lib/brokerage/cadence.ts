import "server-only";

/**
 * Sprint 5 listing cadence helper (U-3).
 *
 * Uses date-fns-tz v3 API:
 *   fromZonedTime  (was zonedTimeToUtc in v2)
 *   toZonedTime    (was utcToZonedTime in v2)
 * Same semantics — v3 only renamed the functions.
 */

import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  addDays,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  isWeekend,
} from "date-fns";

const TZ = "America/Chicago";

/**
 * Returns the next business day (Mon-Fri) at hourCT in America/Chicago,
 * strictly AFTER `from`. If called at 2026-05-01 14:00 CT (Friday) with
 * hourCT=9, returns 2026-05-04 09:00 CT (Monday).
 */
export function nextBusinessDayAt(from: Date, hourCT: number): Date {
  let candidate = toZonedTime(from, TZ);
  candidate = addDays(candidate, 1);
  while (isWeekend(candidate)) candidate = addDays(candidate, 1);
  candidate = setMilliseconds(
    setSeconds(setMinutes(setHours(candidate, hourCT), 0), 0),
    0,
  );
  return fromZonedTime(candidate, TZ);
}

/**
 * Next 9am CT business day (preview_opens_at).
 * claim_opens_at = preview_opens_at + 24h.
 * claim_closes_at = claim_opens_at + 8h (5pm CT same day).
 */
export function computeListingCadence(sealedAt: Date): {
  previewOpensAt: Date;
  claimOpensAt: Date;
  claimClosesAt: Date;
} {
  const previewOpensAt = nextBusinessDayAt(sealedAt, 9);
  const claimOpensAt = new Date(previewOpensAt.getTime() + 24 * 60 * 60 * 1000);
  const claimClosesAt = new Date(claimOpensAt.getTime() + 8 * 60 * 60 * 1000);
  return { previewOpensAt, claimOpensAt, claimClosesAt };
}
