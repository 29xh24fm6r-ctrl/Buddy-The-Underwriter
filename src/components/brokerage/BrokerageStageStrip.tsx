"use client";

import { useEffect, useState } from "react";

/**
 * Five-stage progress strip for the borrower funnel.
 *
 * Spec: SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 5.
 *
 * Pure presentational: the parent computes the active index from concierge
 * responses (progressPct + dealId + claim state). Mobile-first and
 * accessible: ordered list semantics + aria-current on the active step.
 *
 * Stage choices match the launch promise we make on the marketing page:
 * tell us → upload → prepare → lender review → pick. We do NOT name a
 * specific lender or quote terms here — the redacted KFS / matched lender
 * UX lives downstream in the portal, not in intake.
 */

const STAGES = [
  { key: "tell", label: "Tell us about your loan" },
  { key: "upload", label: "Upload documents" },
  { key: "prepare", label: "Buddy prepares package" },
  { key: "review", label: "Matched lenders review" },
  { key: "pick", label: "You pick the lender" },
] as const;

export type BrokerageStageKey = (typeof STAGES)[number]["key"];

export function BrokerageStageStrip({
  activeStage,
}: {
  activeStage: BrokerageStageKey;
}) {
  const activeIndex = STAGES.findIndex((s) => s.key === activeStage);
  return (
    <ol
      className="grid grid-cols-5 gap-1 sm:gap-2 text-[10px] sm:text-xs"
      aria-label="Application progress"
    >
      {STAGES.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li
            key={s.key}
            aria-current={active ? "step" : undefined}
            className={[
              "flex flex-col items-center gap-1 text-center px-1",
              done
                ? "text-green-700"
                : active
                  ? "text-blue-700 font-medium"
                  : "text-slate-400",
            ].join(" ")}
          >
            <span
              className={[
                "block w-full h-1.5 rounded-full",
                done
                  ? "bg-green-500"
                  : active
                    ? "bg-blue-500"
                    : "bg-slate-200",
              ].join(" ")}
            />
            <span className="leading-tight">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Helper for parents: derive the active stage key from concierge state.
 *
 * Conservative rule:
 *   - no dealId yet            → "tell"
 *   - progress < 60            → "tell"
 *   - dealId + progress >= 60  → "upload"
 *   - sealed                   → "prepare"
 *   - listed                   → "review"
 *   - claim window closed      → "pick"
 *
 * Sealing / listing / claim-window state must be pushed from the server
 * (the public concierge response intentionally does NOT leak listing
 * timing). The parent reads those flags from the borrower portal once
 * the borrower has an email + session.
 */
export function deriveBrokerageStage(args: {
  hasDealId: boolean;
  progressPct: number;
  sealed?: boolean;
  listed?: boolean;
  claimWindowClosed?: boolean;
}): BrokerageStageKey {
  if (args.claimWindowClosed) return "pick";
  if (args.listed) return "review";
  if (args.sealed) return "prepare";
  if (args.hasDealId && args.progressPct >= 60) return "upload";
  return "tell";
}

/**
 * Test-only export of the canonical stage list.
 */
export const __test_BROKERAGE_STAGES = STAGES;

/**
 * Convenience: a static, view-only strip pinned to "tell" — handy for
 * loading states before any concierge round-trip has resolved.
 */
export function BrokerageStageStripIdle() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <BrokerageStageStrip activeStage="tell" />;
}
