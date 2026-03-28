"use client";

/**
 * Phase 65G — Deal Urgency Banner
 *
 * Top-level banner showing urgency bucket, top stuck reason, and stage age.
 */

import type { DealUrgencyBucket, StuckReasonCode } from "@/core/sla/types";
import { DealTempoBadge } from "./DealTempoBadge";

const STUCK_LABELS: Record<StuckReasonCode, string> = {
  stage_overdue: "Stage overdue",
  primary_action_stale: "Primary action stale",
  borrower_unresponsive: "Borrower unresponsive",
  borrower_opened_not_submitted: "Borrower started but not submitted",
  uploads_waiting_for_review: "Uploads waiting for review",
  memo_gap_aging: "Memo blockers aging",
  pricing_waiting_on_assumptions: "Pricing assumptions needed",
  closing_stalled: "Closing stalled",
  banker_inactive_on_critical_action: "Banker inactive on critical action",
};

const BANNER_STYLES: Record<DealUrgencyBucket, string> = {
  healthy: "border-green-200 bg-green-50",
  watch: "border-yellow-200 bg-yellow-50",
  urgent: "border-orange-200 bg-orange-50",
  critical: "border-red-200 bg-red-50",
};

export function DealUrgencyBanner({
  urgencyBucket,
  stageAgeHours,
  stuckReasonCodes,
  canonicalStage,
}: {
  urgencyBucket: DealUrgencyBucket;
  stageAgeHours: number;
  stuckReasonCodes: StuckReasonCode[];
  canonicalStage: string;
}) {
  if (urgencyBucket === "healthy") return null;

  const topReason = stuckReasonCodes[0];

  return (
    <div
      data-testid="deal-urgency-banner"
      className={`rounded-lg border p-3 ${BANNER_STYLES[urgencyBucket]}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DealTempoBadge bucket={urgencyBucket} />
          <span className="text-sm font-medium text-neutral-800">
            {formatStage(canonicalStage)}
          </span>
          <span className="text-xs text-neutral-500">
            {stageAgeHours}h in stage
          </span>
        </div>
      </div>
      {topReason && (
        <div className="mt-1 text-xs text-neutral-600">
          {STUCK_LABELS[topReason] ?? topReason}
          {stuckReasonCodes.length > 1 && (
            <span className="text-neutral-400">
              {" "}+ {stuckReasonCodes.length - 1} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatStage(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
