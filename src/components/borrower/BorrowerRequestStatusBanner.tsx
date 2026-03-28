"use client";

/**
 * Phase 65F — Borrower Request Status Banner
 *
 * Shows a top-level progress summary for borrower portal.
 * Plain English, no internal terminology.
 */

export function BorrowerRequestStatusBanner({
  statusLabel,
  progressPercent,
  completedItems,
  totalItems,
}: {
  statusLabel: string;
  progressPercent: number;
  completedItems: number;
  totalItems: number;
}) {
  const isComplete = progressPercent >= 100;

  return (
    <div
      data-testid="borrower-request-status-banner"
      className={`rounded-lg border p-4 ${
        isComplete
          ? "border-green-200 bg-green-50"
          : "border-blue-200 bg-blue-50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-sm font-semibold ${
            isComplete ? "text-green-800" : "text-blue-800"
          }`}
        >
          {statusLabel}
        </span>
        <span className="text-xs text-neutral-600">
          {completedItems} of {totalItems} complete
        </span>
      </div>

      <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete ? "bg-green-500" : "bg-blue-500"
          }`}
          style={{ width: `${Math.min(progressPercent, 100)}%` }}
        />
      </div>

      {isComplete && (
        <p className="text-xs text-green-700 mt-2">
          All requested items have been received. Your lender will review them shortly.
        </p>
      )}
    </div>
  );
}
