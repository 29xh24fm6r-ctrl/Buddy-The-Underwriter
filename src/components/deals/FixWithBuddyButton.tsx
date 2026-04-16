"use client";

import { useEffect, useState } from "react";
import { IgniteWizard } from "./IgniteWizard";

/**
 * Phase 83: "Fix with Buddy" entry point.
 *
 * Auto-opens when recovery/status reports `shouldShowWizard: true`
 * (critical blockers OR trustGrade === "manual_review_required"),
 * and always renders a manual-open button.
 */
export function FixWithBuddyButton({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/recovery/status`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d.ok && d.shouldShowWizard) setOpen(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dealId]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500/20 to-violet-500/20 border border-sky-500/30 text-sky-400 hover:from-sky-500/30 hover:to-violet-500/30 text-xs font-semibold transition-all"
      >
        <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
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
    </>
  );
}
