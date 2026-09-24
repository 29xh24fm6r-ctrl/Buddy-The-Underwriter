"use client";

import { useState, useEffect } from "react";

interface DSCRAlertBannerProps {
  dealId: string;
  dscrBelowThreshold: boolean;
  baseCoverage: Array<number | null | undefined>;
  downsideCoverage: Array<number | null | undefined>;
}

export default function DSCRAlertBanner({
  dealId,
  dscrBelowThreshold,
  baseCoverage,
  downsideCoverage,
}: DSCRAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `sba-dscr-alert-dismissed-${dealId}`;
    if (sessionStorage.getItem(key) === "true") {
      setDismissed(true);
    }
  }, [dealId]);

  if (!dscrBelowThreshold || dismissed) return null;

  const describe = (values: Array<number | null | undefined>) => values.map((value, index) =>
    `Year ${index + 1}: ${typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}x` : "not available"}`).join("; ");

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
          Coverage requires review across the three-year forecast.
          Base case: {describe(baseCoverage)}. Downside: {describe(downsideCoverage)}.
          Review the sensitivity analysis and confirm lender requirements before submission.
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
