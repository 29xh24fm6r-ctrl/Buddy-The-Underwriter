"use client";

import { useEffect, useState } from "react";
import { IgniteWizard } from "./IgniteWizard";

type RecoveryStatus = {
  ok: boolean;
  trustGrade: string | null;
};

/**
 * Phase 83: Intelligence tab banner.
 *
 * Shows only when trust grade is "research_failed" or "manual_review_required".
 * Primary action: "Fix with Buddy" (opens IgniteWizard).
 */
export function IntelligenceRecoveryBanner({ dealId }: { dealId: string }) {
  const [trustGrade, setTrustGrade] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/recovery/status`)
      .then(r => r.json())
      .then((d: RecoveryStatus) => {
        if (!cancelled) {
          setTrustGrade(d?.trustGrade ?? null);
          setLoaded(true);
        }
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [dealId]);

  if (!loaded) return null;
  if (trustGrade !== "research_failed" && trustGrade !== "manual_review_required") return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <span className="material-symbols-outlined text-amber-400 text-[18px]">warning</span>
      <div className="flex-1 text-xs text-amber-300">
        {trustGrade === "research_failed"
          ? "Research failed — entity could not be confirmed."
          : "Research returned with gaps — consider re-running after adding more context."}
      </div>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
      >
        <span className="material-symbols-outlined text-[13px]">rocket_launch</span>
        Fix with Buddy
      </button>
      {open && (
        <IgniteWizard
          dealId={dealId}
          onComplete={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
