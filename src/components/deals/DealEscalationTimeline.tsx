"use client";

/**
 * Phase 65G — Deal Escalation Timeline
 *
 * Shows escalation + auto-advance event history.
 */

import { useState, useEffect } from "react";
import type { EscalationSeverity } from "@/core/sla/types";

type EscalationEvent = {
  id: string;
  escalation_code: string;
  severity: EscalationSeverity;
  message: string;
  is_active: boolean;
  first_triggered_at: string;
  last_triggered_at: string;
};

const SEVERITY_DOT: Record<EscalationSeverity, string> = {
  info: "bg-neutral-300",
  watch: "bg-yellow-400",
  urgent: "bg-orange-400",
  critical: "bg-red-500",
};

export function DealEscalationTimeline({ dealId }: { dealId: string }) {
  const [escalations, setEscalations] = useState<EscalationEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchTempo() {
      try {
        const res = await fetch(`/api/deals/${dealId}/tempo`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setEscalations(json.activeEscalations ?? []);
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTempo();
    return () => { cancelled = true; };
  }, [dealId]);

  if (loading || escalations.length === 0) return null;

  return (
    <section
      data-testid="deal-escalation-timeline"
      className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        Active Escalations
      </div>

      <ul className="space-y-2">
        {escalations.map((esc) => (
          <li key={esc.id} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[esc.severity]}`}
            />
            <div>
              <div className="font-medium text-neutral-800">
                {esc.message}
              </div>
              <div className="text-[10px] text-neutral-400">
                Since {new Date(esc.first_triggered_at).toLocaleDateString()}
                {esc.last_triggered_at !== esc.first_triggered_at && (
                  <> &middot; Last checked {new Date(esc.last_triggered_at).toLocaleDateString()}</>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
