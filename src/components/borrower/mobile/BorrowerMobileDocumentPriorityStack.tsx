"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerMobilePriorityItem } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";

const PRIORITY_PILL: Record<
  BorrowerMobilePriorityItem["priority"],
  { bg: string; text: string; label: string }
> = {
  required: { bg: "bg-amber-100", text: "text-amber-900", label: "Required" },
  helpful: { bg: "bg-sky-100", text: "text-sky-900", label: "Helpful" },
  optional: { bg: "bg-slate-100", text: "text-slate-700", label: "Optional" },
};

export function BorrowerMobileDocumentPriorityStack({
  items,
  hasMore,
  moreHref,
  receivedSummary,
}: {
  items: BorrowerMobilePriorityItem[];
  hasMore: boolean;
  moreHref?: string;
  receivedSummary?: string;
}) {
  return (
    <section className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="cloud_upload" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-slate-900">
          Documents to handle next
        </h3>
      </div>

      {receivedSummary && (
        <p className="mt-2 text-xs text-slate-600">{receivedSummary}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-600">
          Buddy will list documents needing action here as they appear.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const pill = PRIORITY_PILL[item.priority];
            return (
              <li
                key={item.id}
                className="rounded-xl border border-slate-100 bg-slate-50/50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          pill.bg,
                          pill.text,
                        )}
                      >
                        {pill.label}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {item.label}
                      </span>
                    </div>
                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {item.href && (
                    <a
                      href={item.href}
                      aria-label={`Upload ${item.label}`}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl brand-gradient-cta px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue-500 focus-visible:ring-offset-2"
                    >
                      <Icon
                        name="cloud_upload"
                        className="h-3.5 w-3.5 text-current"
                      />
                      Upload
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <a
          href={moreHref ?? "#documents"}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          See all documents
          <Icon name="arrow_forward_ios" className="h-3 w-3 text-current" />
        </a>
      )}
    </section>
  );
}
