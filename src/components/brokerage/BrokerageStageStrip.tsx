"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

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
                ? "text-emerald-700"
                : active
                  ? "text-brand-blue-500 font-medium"
                  : "text-slate-400",
            ].join(" ")}
          >
            <span
              className={[
                "block w-full h-1.5 rounded-full",
                done
                  ? "bg-emerald-500"
                  : active
                    ? "bg-gradient-to-r from-[#1c8de0] to-[#4db8f0]"
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

// ─── Detailed journey checklist ─────────────────────────────────────────
//
// The 5-stage strip above answers "which macro-stage am I in"; this
// answers "what specifically is left in that stage" — the sub-item
// detail that actually reduces borrower anxiety (SPEC: borrower UX
// revolutionize-SBA-lending initiative). One status shape, sourced from
// GET /api/brokerage/deals/[dealId]/seal-status, rendered identically on
// /start and on /portal/[token] (the same borrower journey — see
// isPublicBorrowerPortalRoute / the brokerage upload→portal hand-off in
// /api/brokerage/upload/prepare) so the mental model never resets.

export type MarketplaceListingStatus =
  | "pending_preview"
  | "previewing"
  | "claiming"
  | "awaiting_borrower_pick"
  | "picked"
  | "expired"
  | "relisted";

export type JourneyStatusInput = {
  hasDealId: boolean;
  progressPct: number;
  documentsUploadedCount: number;
  sealed: boolean;
  listingStatus: MarketplaceListingStatus | null;
  matchedLenderCount: number;
  claimsCount: number;
};

export type JourneyItemState = "done" | "current" | "upcoming";

export type JourneyChecklistItem = {
  key: string;
  label: string;
  state: JourneyItemState;
};

export type JourneyChecklistStage = {
  key: BrokerageStageKey;
  label: string;
  state: JourneyItemState;
  items: JourneyChecklistItem[];
};

export function deriveJourneyChecklist(
  input: JourneyStatusInput,
): JourneyChecklistStage[] {
  const claimWindowClosed =
    input.listingStatus === "awaiting_borrower_pick" ||
    input.listingStatus === "picked";
  const listed = input.listingStatus === "claiming";

  const activeStage = deriveBrokerageStage({
    hasDealId: input.hasDealId,
    progressPct: input.progressPct,
    sealed: input.sealed,
    listed,
    claimWindowClosed,
  });
  const activeIndex = STAGES.findIndex((s) => s.key === activeStage);
  // "picked" is the one truly terminal state — the whole journey is
  // complete, including the final "pick" stage itself, so every stage
  // reads as done rather than leaving the last one stuck on "current".
  const journeyComplete = input.listingStatus === "picked";

  function stageState(index: number): JourneyItemState {
    if (journeyComplete) return "done";
    if (index < activeIndex) return "done";
    if (index === activeIndex) return "current";
    return "upcoming";
  }

  // Sub-item state only matters while its stage is "current" — once the
  // borrower has moved past a stage every item in it reads as done, and
  // future stages stay upcoming, so nothing shows a contradictory mix.
  function itemState(stageIndex: number, computedDone: boolean): JourneyItemState {
    const st = stageState(stageIndex);
    if (st !== "current") return st;
    return computedDone ? "done" : "current";
  }

  return [
    {
      key: "tell",
      label: STAGES[0].label,
      state: stageState(0),
      items: [
        {
          key: "started",
          label: "Started your application",
          state: itemState(0, input.hasDealId),
        },
        {
          key: "details",
          label:
            input.hasDealId && input.progressPct < 60
              ? `Business & loan details — ${input.progressPct}% complete`
              : "Business & loan details",
          state: itemState(0, input.progressPct >= 60),
        },
      ],
    },
    {
      key: "upload",
      label: STAGES[1].label,
      state: stageState(1),
      items: [
        {
          key: "docs",
          label:
            input.documentsUploadedCount > 0
              ? `${input.documentsUploadedCount} document${input.documentsUploadedCount === 1 ? "" : "s"} uploaded`
              : "Upload your documents",
          state: itemState(1, input.documentsUploadedCount > 0),
        },
      ],
    },
    {
      key: "prepare",
      label: STAGES[2].label,
      state: stageState(2),
      items: [
        {
          key: "sealed",
          label: input.sealed
            ? "Package sealed and ready"
            : "Buddy is assembling your package",
          state: itemState(2, input.sealed),
        },
      ],
    },
    {
      key: "review",
      label: STAGES[3].label,
      state: stageState(3),
      items: [
        {
          key: "listed",
          label:
            input.matchedLenderCount > 0
              ? `${input.matchedLenderCount} matched lender${input.matchedLenderCount === 1 ? "" : "s"} reviewing`
              : "Listing to matched lenders",
          state: itemState(3, listed || claimWindowClosed),
        },
      ],
    },
    {
      key: "pick",
      label: STAGES[4].label,
      state: stageState(4),
      items: [
        {
          key: "pick",
          label:
            input.listingStatus === "picked"
              ? "Lender selected"
              : input.claimsCount > 0
                ? `${input.claimsCount} lender${input.claimsCount === 1 ? "" : "s"} ready for you to choose`
                : "Waiting for lenders to claim",
          state: itemState(4, input.listingStatus === "picked"),
        },
      ],
    },
  ];
}

const ITEM_STATE_STYLES: Record<JourneyItemState, { icon: "check_circle" | "pending" | "radio_button_unchecked"; iconClass: string; textClass: string }> = {
  done: { icon: "check_circle", iconClass: "text-emerald-600", textClass: "text-slate-700" },
  current: { icon: "pending", iconClass: "text-brand-blue-500", textClass: "text-slate-900 font-medium" },
  upcoming: { icon: "radio_button_unchecked", iconClass: "text-slate-300", textClass: "text-slate-400" },
};

/**
 * Persistent, detailed "where am I" checklist. Renders the 5 macro
 * stages with their sub-items visible for the completed-and-current
 * stages (future stages collapse to just the stage label, since there's
 * nothing concrete to check off yet).
 */
export function BorrowerJourneyChecklist({
  status,
}: {
  status: JourneyStatusInput;
}) {
  const stages = deriveJourneyChecklist(status);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Lender matching progress
      </div>
      <ol className="mt-4 space-y-4">
        {stages.map((stage, i) => {
          const isFuture = stage.state === "upcoming" && stage.items.every((it) => it.state === "upcoming");
          return (
            <li key={stage.key}>
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    stage.state === "done"
                      ? "bg-emerald-100 text-emerald-700"
                      : stage.state === "current"
                        ? "brand-gradient-cta text-white"
                        : "bg-slate-100 text-slate-400",
                  ].join(" ")}
                >
                  {stage.state === "done" ? (
                    <Icon name="check_circle" className="h-3.5 w-3.5 text-current" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={[
                    "text-sm",
                    stage.state === "current"
                      ? "font-semibold text-slate-900"
                      : stage.state === "done"
                        ? "font-medium text-slate-700"
                        : "text-slate-400",
                  ].join(" ")}
                >
                  {stage.label}
                </span>
              </div>
              {!isFuture && (
                <ul className="ml-8 mt-2 space-y-1.5 border-l border-slate-100 pl-4">
                  {stage.items.map((item) => {
                    const s = ITEM_STATE_STYLES[item.state];
                    return (
                      <li key={item.key} className="flex items-center gap-2 text-xs">
                        <Icon name={s.icon} className={`h-3.5 w-3.5 shrink-0 ${s.iconClass}`} />
                        <span className={s.textClass}>{item.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
