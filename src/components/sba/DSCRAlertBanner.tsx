"use client";

import { useState, useEffect } from "react";

interface DSCRAlertBannerProps {
  dealId: string;
  dscrBelowThreshold: boolean;
  failingYears: number[];
  lowestDscr: number;
}

export default function DSCRAlertBanner({
  dealId,
  dscrBelowThreshold,
  failingYears,
  lowestDscr,
}: DSCRAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `sba-dscr-alert-dismissed-${dealId}`;
    if (sessionStorage.getItem(key) === "true") {
      setDismissed(true);
    }
  }, [dealId]);

  if (!dscrBelowThreshold || dismissed) return null;

  const yearLabels = failingYears.map((y) => `Year ${y}`).join(", ");

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-600/10 px-4 py-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <span
          className="material-symbols-outlined text-amber-400 shrink-0"
          style={{ fontSize: 20 }}
        >
          warning
        </span>
        <p className="text-sm text-amber-200">
          {yearLabels} DSCR of {lowestDscr.toFixed(2)}x falls below the SBA
          1.25x guideline under the base scenario. Consider adjusting loan
          structure or assumptions before submission.
        </p>
      </div>
      <button
        onClick={() => {
          sessionStorage.setItem(
            `sba-dscr-alert-dismissed-${dealId}`,
            "true",
          );
          setDismissed(true);
        }}
        className="shrink-0 text-xs text-amber-300 hover:text-amber-100"
      >
        Dismiss
      </button>
    </div>
  );
}
