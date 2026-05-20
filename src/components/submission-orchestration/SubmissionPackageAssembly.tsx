"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  SubmissionPackageSection,
  SubmissionPackageSectionStatus,
  SubmissionPackageItemStatus,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { SUBMISSION_PACKAGE_SECTION_STATUS_LABELS } from "@/lib/banker/buildSubmissionOrchestrationViewModel";

const STATUS_STYLES: Record<
  SubmissionPackageSectionStatus,
  { dot: string; pillBg: string; pillText: string }
> = {
  complete: {
    dot: "bg-emerald-400",
    pillBg: "bg-emerald-500/15 ring-1 ring-emerald-400/30",
    pillText: "text-emerald-200",
  },
  partial: {
    dot: "bg-sky-400",
    pillBg: "bg-sky-500/15 ring-1 ring-sky-400/30",
    pillText: "text-sky-200",
  },
  needs_attention: {
    dot: "bg-amber-400",
    pillBg: "bg-amber-500/15 ring-1 ring-amber-400/30",
    pillText: "text-amber-200",
  },
  unavailable: {
    dot: "bg-stone-500",
    pillBg: "bg-white/5 ring-1 ring-white/10",
    pillText: "text-stone-400",
  },
};

const ITEM_GLYPH: Record<SubmissionPackageItemStatus, string> = {
  included: "✓",
  missing: "✕",
  needs_attention: "!",
  unavailable: "—",
};

const ITEM_TONE: Record<SubmissionPackageItemStatus, string> = {
  included: "text-emerald-300",
  missing: "text-rose-300",
  needs_attention: "text-amber-300",
  unavailable: "text-stone-400",
};

export function SubmissionPackageAssembly({
  sections,
}: {
  sections: SubmissionPackageSection[];
}) {
  if (sections.length === 0) return null;
  return (
    <section
      role="region"
      aria-label="Submission package assembly"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5">
          <Icon name="file" className="h-3.5 w-3.5 text-white/80" />
        </div>
        <h3 className="text-sm font-semibold text-white">Package assembly</h3>
      </header>

      <ul
        className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2"
        role="list"
        aria-label="Package sections"
      >
        {sections.map((section) => {
          const style = STATUS_STYLES[section.status];
          const statusLabel = SUBMISSION_PACKAGE_SECTION_STATUS_LABELS[section.status];
          return (
            <li
              key={section.id}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", style.dot)} />
                <h4 className="text-sm font-semibold text-white">{section.label}</h4>
                <span
                  className={cn(
                    "ml-auto inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    style.pillBg,
                    style.pillText,
                  )}
                  aria-label={`Status: ${statusLabel}`}
                >
                  {statusLabel}
                </span>
              </div>

              <dl
                className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/50"
                aria-label="Section counts"
              >
                <div>
                  <dt>Included</dt>
                  <dd className="mt-0.5 text-base font-semibold text-white">
                    {section.includedCount}
                  </dd>
                </div>
                <div>
                  <dt>Missing</dt>
                  <dd className="mt-0.5 text-base font-semibold text-white">
                    {section.missingCount}
                  </dd>
                </div>
                <div>
                  <dt>Flagged</dt>
                  <dd className="mt-0.5 text-base font-semibold text-white">
                    {section.needsAttentionCount}
                  </dd>
                </div>
              </dl>

              {section.items.length === 0 ? (
                <p className="mt-2 text-xs italic text-white/60">
                  No items tracked in this section yet.
                </p>
              ) : (
                <ul
                  className="mt-2 space-y-1.5"
                  role="list"
                  aria-label={`${section.label} items`}
                >
                  {section.items.slice(0, 8).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 text-xs text-white/80"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex h-4 w-4 items-center justify-center text-[10px] font-bold",
                          ITEM_TONE[item.status],
                        )}
                      >
                        {ITEM_GLYPH[item.status]}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.href && (
                        <a
                          href={item.href}
                          aria-label={`Open ${item.label}`}
                          className="rounded px-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        >
                          Open
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
