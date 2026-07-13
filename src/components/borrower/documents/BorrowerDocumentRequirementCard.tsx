"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerDocumentRequirement,
  BorrowerDocumentStatus,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { BorrowerDocumentGuidanceBlock } from "./BorrowerDocumentGuidanceBlock";

const STATUS_STYLES: Record<
  BorrowerDocumentStatus,
  { dot: string; pillBg: string; pillText: string }
> = {
  missing: {
    dot: "bg-amber-500",
    pillBg: "bg-amber-50",
    pillText: "text-amber-800",
  },
  uploaded: {
    dot: "bg-sky-500",
    pillBg: "bg-sky-50",
    pillText: "text-sky-800",
  },
  received: {
    dot: "bg-emerald-500",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-800",
  },
  reviewing: {
    dot: "bg-sky-500",
    pillBg: "bg-sky-50",
    pillText: "text-sky-800",
  },
  accepted: {
    dot: "bg-emerald-600",
    pillBg: "bg-emerald-50",
    pillText: "text-emerald-900",
  },
  needs_attention: {
    dot: "bg-amber-600",
    pillBg: "bg-amber-50",
    pillText: "text-amber-900",
  },
  optional: {
    dot: "bg-slate-400",
    pillBg: "bg-slate-100",
    pillText: "text-slate-700",
  },
  unavailable: {
    dot: "bg-slate-300",
    pillBg: "bg-slate-100",
    pillText: "text-slate-600",
  },
};

function formatTimestamp(iso: string): string | null {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export function BorrowerDocumentRequirementCard({
  requirement,
}: {
  requirement: BorrowerDocumentRequirement;
}) {
  const style = STATUS_STYLES[requirement.status];
  const latest = requirement.latestUploadedAt
    ? formatTimestamp(requirement.latestUploadedAt)
    : null;
  const hasCta = Boolean(requirement.ctaLabel && requirement.href);
  const showReplacement =
    (requirement.uploadCount ?? 0) > 0 && requirement.status !== "accepted";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                style.pillBg,
                style.pillText,
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
                aria-hidden="true"
              />
              {requirement.statusLabel}
            </span>
            {requirement.required ? (
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                Required
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Optional
              </span>
            )}
          </div>
          <h4 className="font-heading mt-2 text-sm font-semibold text-slate-900 sm:text-base">
            {requirement.label}
          </h4>
          {latest && (
            <p className="mt-0.5 text-xs text-slate-500">
              Latest upload received {latest}
              {requirement.uploadCount && requirement.uploadCount > 1
                ? ` · ${requirement.uploadCount} uploads on file`
                : ""}
            </p>
          )}
        </div>

        {hasCta && (
          <a
            href={requirement.href}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl brand-gradient-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2"
          >
            <Icon name="cloud_upload" className="h-4 w-4 text-current" />
            {requirement.ctaLabel}
          </a>
        )}
      </div>

      {requirement.reassurance && (
        <p className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs leading-5 text-emerald-900">
          {requirement.reassurance}
        </p>
      )}

      {requirement.recoveryMessage && (
        <p className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900">
          {requirement.recoveryMessage}
        </p>
      )}

      <div className="mt-3">
        <BorrowerDocumentGuidanceBlock guidance={requirement.guidance} />
      </div>

      {showReplacement && hasCta && requirement.ctaLabel === "Upload updated version" && (
        <p className="mt-2 text-[11px] text-slate-500">
          Uploading an updated version does not erase your previous submission.
        </p>
      )}
    </article>
  );
}
