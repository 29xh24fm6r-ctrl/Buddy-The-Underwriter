"use client";

import { BorrowerChecklistHelpText } from "@/components/borrower/BorrowerChecklistHelpText";
import {
  BorrowerChecklistStatusPill,
  type BorrowerChecklistTone,
} from "@/components/borrower/BorrowerChecklistStatusPill";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type HelpContent = {
  why: string;
  formats: string;
  examples: string;
  scans: string;
};

export function BorrowerChecklistItem({
  title,
  description,
  statusLabel,
  statusTone,
  helper,
  required,
  completedLabel,
}: {
  title: string;
  description?: string | null;
  statusLabel: string;
  statusTone: BorrowerChecklistTone;
  helper: HelpContent;
  required: boolean;
  completedLabel?: string | null;
}) {
  return (
    <article
      className={cn(
        "rounded-[1.25rem] border px-4 py-4",
        statusTone === "complete"
          ? "border-emerald-200 bg-emerald-50/55"
          : "border-stone-200 bg-white",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-stone-950">{title}</h4>
            {required ? (
              <BorrowerChecklistStatusPill label="Required" tone="required" />
            ) : (
              <BorrowerChecklistStatusPill label="Optional" tone="optional" />
            )}
          </div>
          {description ? (
            <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
          ) : null}
          {completedLabel ? (
            <div className="mt-2 text-sm text-stone-500">{completedLabel}</div>
          ) : null}
        </div>
        <div className="shrink-0">
          <BorrowerChecklistStatusPill label={statusLabel} tone={statusTone} />
        </div>
      </div>
      <div className="mt-4">
        <BorrowerChecklistHelpText content={helper} />
      </div>
      {statusTone === "required" ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Icon name="cloud_upload" className="h-4 w-4 text-current" />
          Add this next to keep your package moving.
        </div>
      ) : null}
    </article>
  );
}
