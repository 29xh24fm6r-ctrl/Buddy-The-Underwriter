"use client";

import { useEffect, useState } from "react";
import { IgniteWizard } from "@/components/deals/IgniteWizard";

type RecoveryStatus = {
  ok: boolean;
  shouldShowWizard: boolean;
  hasCriticalBlockers: boolean;
  trustGrade: string | null;
  blockers: Array<{ key: string; severity: string; label: string; detail: string }>;
};

/**
 * Phase 83: Credit memo blocked-state recovery panel.
 *
 * Renders when research status signals the memo can't move forward:
 *   - trustGrade === "research_failed" or "manual_review_required"
 *   - OR any critical blocker from recovery/status
 *
 * Primary CTA: "Fix with Buddy" — opens IgniteWizard. Replaces the old
 * one-click "Run Research" that would otherwise fail for the same reason.
 */
export default function BlockedMemoRecoveryPanel({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [igniteOpen, setIgniteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/recovery/status`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setStatus(d);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [dealId]);

  if (!loaded || !status?.ok) return null;

  const isBlocked =
    status.hasCriticalBlockers ||
    status.trustGrade === "research_failed" ||
    status.trustGrade === "manual_review_required";

  if (!isBlocked) return null;

  const errorBlockers = status.blockers.filter(b => b.severity === "error");
  const warnBlockers = status.blockers.filter(b => b.severity === "warn");
  const headline =
    status.trustGrade === "research_failed"
      ? "Memo blocked — research failed"
      : errorBlockers.length > 0
        ? "Memo blocked — research cannot run yet"
        : "Memo needs another pass — research returned with gaps";

  return (
    <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-400 text-[20px] mt-0.5">warning</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-300">{headline}</div>
          {(errorBlockers.length > 0 || warnBlockers.length > 0) && (
            <ul className="mt-2 space-y-1 text-xs text-amber-200/80">
              {[...errorBlockers, ...warnBlockers].slice(0, 4).map(b => (
                <li key={b.key} className="flex items-start gap-1.5">
                  <span className="text-amber-400/60 mt-0.5">•</span>
                  <span><span className="font-semibold text-amber-200">{b.label}:</span> {b.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => setIgniteOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg hover:from-sky-400 hover:to-violet-400 transition-all"
        >
          <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
          Fix with Buddy
        </button>
      </div>

      {igniteOpen && (
        <IgniteWizard
          dealId={dealId}
          onComplete={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          onClose={() => setIgniteOpen(false)}
        />
      )}
    </div>
  );
}
