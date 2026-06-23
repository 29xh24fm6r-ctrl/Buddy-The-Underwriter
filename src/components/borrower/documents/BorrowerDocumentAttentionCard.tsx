"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerDocumentRequirement } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

export function BorrowerDocumentAttentionCard({
  items,
}: {
  items: BorrowerDocumentRequirement[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[1.5rem] border border-amber-200/70 bg-[linear-gradient(135deg,_rgba(255,251,235,0.6)_0%,_rgba(254,243,199,0.25)_100%)] p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
          <Icon name="error" className="h-4 w-4 text-amber-700" />
        </div>
        <h3 className="text-sm font-semibold text-amber-900">
          Items Buddy needs next
        </h3>
      </div>
      <p className="mt-2 text-xs text-amber-800/80">
        These are the highest-impact items to keep your package moving forward.
      </p>

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-amber-100 bg-white p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-stone-900">
                    {item.label}
                  </span>
                  <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                    {item.statusLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-600">
                  {item.guidance.whyItMatters}
                </p>
                {item.recoveryMessage && (
                  <p className="mt-2 text-xs leading-5 text-amber-900">
                    {item.recoveryMessage}
                  </p>
                )}
              </div>
              {item.ctaLabel && item.href && (
                <a
                  href={item.href}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-stone-950 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-stone-800"
                >
                  <Icon name="cloud_upload" className="h-3.5 w-3.5 text-current" />
                  {item.ctaLabel}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
