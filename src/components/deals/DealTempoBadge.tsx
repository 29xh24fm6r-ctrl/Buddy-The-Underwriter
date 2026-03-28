"use client";

/**
 * Phase 65G — Deal Tempo Badge
 *
 * Small badge for deal lists/queues showing urgency bucket.
 */

import type { DealUrgencyBucket } from "@/core/sla/types";

const BUCKET_STYLES: Record<DealUrgencyBucket, string> = {
  healthy: "bg-green-100 text-green-700",
  watch: "bg-yellow-100 text-yellow-700",
  urgent: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const BUCKET_LABELS: Record<DealUrgencyBucket, string> = {
  healthy: "Healthy",
  watch: "Watch",
  urgent: "Urgent",
  critical: "Critical",
};

export function DealTempoBadge({
  bucket,
}: {
  bucket: DealUrgencyBucket;
}) {
  return (
    <span
      data-testid="deal-tempo-badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${BUCKET_STYLES[bucket]}`}
    >
      {BUCKET_LABELS[bucket]}
    </span>
  );
}
