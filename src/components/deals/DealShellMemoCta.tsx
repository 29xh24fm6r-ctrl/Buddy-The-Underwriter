"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Readiness-aware Credit Memo CTA for DealShell.
 *
 * Behavior (Perfect Banker Flow v1):
 *   - Memo not ready              → "Complete Memo Inputs" → /memo-inputs
 *   - Memo ready, not submitted   → "Review Credit Memo"   → /credit-memo
 *   - Submitted (banker→underw)   → "View Submitted Memo"  → /credit-memo
 *
 * The component fetches /api/deals/[dealId]/readiness once on mount.
 * If the fetch fails, falls back to the legacy "Credit Memo" label so the
 * banker is never stranded.
 */
export default function DealShellMemoCta({ dealId }: { dealId: string }) {
  const [state, setState] = useState<{
    label: string;
    href: string;
    description?: string;
    disabled?: boolean;
  }>({
    label: "Credit Memo",
    href: `/deals/${dealId}/credit-memo`,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/readiness`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          readiness?: {
            groups?: {
              credit_memo?: { ready?: boolean };
              memo_inputs?: { ready?: boolean };
            };
          };
        };
        if (cancelled || !json.ok || !json.readiness) return;
        const memoReady = json.readiness.groups?.memo_inputs?.ready === true;
        const submittedFlow =
          json.readiness.groups?.credit_memo?.ready === true && memoReady;

        // Detect "submitted" via the credit_memo group reason chain — a
        // submitted-but-not-finalized memo flips credit_memo.ready to true
        // even if memo_inputs.ready is false (banker view changes once
        // submitted). We use a separate fetch for status if needed; for
        // now treat ready+memoReady as "review" and ready+!memoReady as
        // "view submitted".
        if (submittedFlow) {
          setState({
            label: "Review Credit Memo",
            href: `/deals/${dealId}/credit-memo`,
            description: "Memo inputs satisfied — ready for banker review",
          });
        } else if (json.readiness.groups?.credit_memo?.ready) {
          setState({
            label: "View Submitted Memo",
            href: `/deals/${dealId}/credit-memo`,
            description: "Awaiting underwriter review",
          });
        } else {
          setState({
            label: "Complete Memo Inputs",
            href: `/deals/${dealId}/memo-inputs`,
            description: "Required before credit memo submission",
          });
        }
      } catch {
        // Fall back to default label.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  return (
    <Link
      href={state.href}
      title={state.description ?? state.label}
      data-testid="dealshell-memo-cta"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary/90"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        description
      </span>
      <span className="hidden sm:inline">{state.label}</span>
    </Link>
  );
}
