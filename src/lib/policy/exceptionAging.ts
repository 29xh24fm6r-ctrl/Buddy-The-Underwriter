/**
 * Exception aging bucket logic.
 * Pure module — no DB, no server-only.
 */

export type ExceptionAgingBucket =
  | "0_2_days"
  | "3_7_days"
  | "8_14_days"
  | "15_plus_days";

const BUCKET_LABELS: Record<ExceptionAgingBucket, string> = {
  "0_2_days": "< 3 days",
  "3_7_days": "3–7 days",
  "8_14_days": "8–14 days",
  "15_plus_days": "15+ days",
};

/**
 * Compute the aging bucket for an exception based on first_detected_at.
 */
export function computeAgingBucket(firstDetectedAt: string | Date, now?: Date): ExceptionAgingBucket {
  const detected = typeof firstDetectedAt === "string" ? new Date(firstDetectedAt) : firstDetectedAt;
  const ref = now ?? new Date();
  const diffMs = ref.getTime() - detected.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 2) return "0_2_days";
  if (days <= 7) return "3_7_days";
  if (days <= 14) return "8_14_days";
  return "15_plus_days";
}

export function getAgingBucketLabel(bucket: ExceptionAgingBucket): string {
  return BUCKET_LABELS[bucket];
}

export function computeAgeDays(firstDetectedAt: string | Date, now?: Date): number {
  const detected = typeof firstDetectedAt === "string" ? new Date(firstDetectedAt) : firstDetectedAt;
  const ref = now ?? new Date();
  return Math.floor((ref.getTime() - detected.getTime()) / (1000 * 60 * 60 * 24));
}
