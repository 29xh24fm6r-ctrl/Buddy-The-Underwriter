"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import type { BorrowerDocumentGuidance } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

export function BorrowerDocumentGuidanceBlock({
  guidance,
  defaultExpanded = false,
}: {
  guidance: BorrowerDocumentGuidance;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const hasExtras = Boolean(
    guidance.commonIssueToAvoid || guidance.acceptedFormatsCopy,
  );

  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-sky-800">
          <Icon name="fact_check" className="h-3.5 w-3.5 text-sky-700" />
          {expanded ? "Hide guidance" : "What a good upload looks like"}
        </span>
        <Icon
          name={expanded ? "chevron_left" : "chevron_right"}
          className="h-4 w-4 text-stone-500"
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-3">
          <Detail
            label="Why it matters"
            text={guidance.whyItMatters}
          />
          <Detail
            label="What a helpful upload includes"
            text={guidance.helpfulUploadHint}
          />
          {guidance.commonIssueToAvoid && (
            <Detail
              label="Common issue to avoid"
              text={guidance.commonIssueToAvoid}
            />
          )}
          {guidance.acceptedFormatsCopy && (
            <Detail
              label="Accepted formats"
              text={guidance.acceptedFormatsCopy}
            />
          )}
        </div>
      )}

      {!expanded && !hasExtras ? null : null}
    </div>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
        {label}
      </div>
      <p className="mt-0.5 text-xs leading-5 text-stone-700">{text}</p>
    </div>
  );
}
