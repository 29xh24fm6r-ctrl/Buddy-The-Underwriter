"use client";

import Link from "next/link";
import type { LifecycleBlocker, LifecycleStage } from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";

export type StageStatus = "complete" | "current" | "next" | "locked" | "skipped";

export type StageRowProps = {
  stage: LifecycleStage;
  index: number;
  status: StageStatus;
  href: string;
  dealId: string;
  /** Blockers that gate this stage (only shown for locked rows). */
  blockers?: LifecycleBlocker[];
  /** Next action for the current stage only. */
  action?: NextAction | null;
  variant?: "vertical" | "horizontal";
};

const STATUS_DOT: Record<StageStatus, string> = {
  complete: "bg-emerald-500 border-emerald-400",
  current: "bg-blue-500 border-blue-400 ring-2 ring-blue-400/40",
  next: "bg-transparent border-white/40",
  locked: "bg-transparent border-white/15",
  skipped: "bg-transparent border-amber-400/30",
};

const STATUS_LABEL_TEXT: Record<StageStatus, string> = {
  complete: "text-white/70",
  current: "text-white",
  next: "text-white/80",
  locked: "text-white/40",
  skipped: "text-amber-200/60",
};

const STATUS_BADGE: Record<StageStatus, { label: string; classes: string } | null> = {
  complete: { label: "Complete", classes: "bg-emerald-500/15 text-emerald-300" },
  current: { label: "Current", classes: "bg-blue-500/15 text-blue-300" },
  next: { label: "Next up", classes: "bg-white/5 text-white/70" },
  locked: { label: "Locked", classes: "bg-white/5 text-white/40" },
  skipped: { label: "Off path", classes: "bg-amber-500/10 text-amber-300/70" },
};

function ActionButton({ action, dealId }: { action: NextAction; dealId: string }) {
  const baseClasses =
    "mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors";

  if (action.intent === "complete") {
    return (
      <span
        className={`${baseClasses} border border-emerald-500/30 bg-emerald-500/10 text-emerald-200`}
      >
        {action.label}
      </span>
    );
  }

  if (action.intent === "blocked") {
    return (
      <span
        className={`${baseClasses} border border-amber-500/30 bg-amber-500/10 text-amber-200`}
      >
        {action.label}
      </span>
    );
  }

  // navigate / advance / runnable — all surface a link to action.href when present.
  // SPEC-01 keeps this presentation-only; running server actions is deferred.
  const href = action.href ?? `/deals/${dealId}/cockpit`;
  return (
    <Link
      href={href}
      className={`${baseClasses} bg-blue-600 text-white hover:bg-blue-500`}
      aria-label={action.label}
    >
      {action.label}
    </Link>
  );
}

function BlockerChip({
  blocker,
  dealId,
}: {
  blocker: LifecycleBlocker;
  dealId: string;
}) {
  const fix = getBlockerFixAction(blocker, dealId);
  const baseClasses =
    "mt-1 block w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-left text-[11px] text-amber-200";

  if (fix && "href" in fix && fix.href) {
    return (
      <Link href={fix.href} className={`${baseClasses} hover:bg-amber-500/20`}>
        <span className="font-semibold">{blocker.message}</span>
        <span className="ml-1 text-amber-300/80">→ {fix.label}</span>
      </Link>
    );
  }

  return (
    <div className={baseClasses}>
      <span className="font-semibold">{blocker.message}</span>
    </div>
  );
}

export function StageRow({
  stage,
  index,
  status,
  href,
  dealId,
  blockers,
  action,
  variant = "vertical",
}: StageRowProps) {
  const label = STAGE_LABELS[stage] ?? stage;
  const dotClasses = STATUS_DOT[status];
  const textClasses = STATUS_LABEL_TEXT[status];
  const badge = STATUS_BADGE[status];
  const isInteractive = status !== "locked" && status !== "skipped";

  if (variant === "horizontal") {
    const compactClasses =
      "flex shrink-0 flex-col items-center gap-1 px-2 py-1 text-center";
    const inner = (
      <>
        <span
          className={`block h-3 w-3 rounded-full border ${dotClasses}`}
          aria-hidden
        />
        <span className={`text-[10px] font-medium ${textClasses}`}>{label}</span>
      </>
    );

    if (!isInteractive) {
      return (
        <div
          className={compactClasses}
          aria-disabled
          aria-label={`${label} — ${status}`}
          data-testid={`journey-stage-${stage}`}
          data-status={status}
        >
          {inner}
        </div>
      );
    }

    return (
      <Link
        href={href}
        className={compactClasses}
        aria-current={status === "current" ? "step" : undefined}
        aria-label={`${label} — ${status}`}
        data-testid={`journey-stage-${stage}`}
        data-status={status}
      >
        {inner}
      </Link>
    );
  }

  // Vertical row layout
  const baseRowClasses =
    "flex items-start gap-3 rounded-lg px-3 py-2 transition-colors";
  const interactiveClasses = isInteractive
    ? "hover:bg-white/5 cursor-pointer"
    : "cursor-not-allowed";

  const content = (
    <>
      <span className="mt-1 flex flex-col items-center">
        <span
          className={`block h-3 w-3 rounded-full border ${dotClasses}`}
          aria-hidden
        />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm font-medium ${textClasses}`}>
            <span className="mr-1 text-white/40">{index + 1}.</span>
            {label}
          </span>
          {badge ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.classes}`}
            >
              {badge.label}
            </span>
          ) : null}
        </span>
        {status === "current" && action ? (
          <ActionButton action={action} dealId={dealId} />
        ) : null}
        {status === "locked" && blockers && blockers.length > 0 ? (
          <div className="mt-1 space-y-1">
            {blockers.map((b) => (
              <BlockerChip key={b.code} blocker={b} dealId={dealId} />
            ))}
          </div>
        ) : null}
      </span>
    </>
  );

  if (!isInteractive) {
    return (
      <div
        className={`${baseRowClasses} ${interactiveClasses}`}
        aria-disabled="true"
        aria-label={`${label} — ${status}`}
        data-testid={`journey-stage-${stage}`}
        data-status={status}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${baseRowClasses} ${interactiveClasses}`}
      aria-current={status === "current" ? "step" : undefined}
      aria-label={`${label} — ${status}`}
      data-testid={`journey-stage-${stage}`}
      data-status={status}
    >
      {content}
    </Link>
  );
}
