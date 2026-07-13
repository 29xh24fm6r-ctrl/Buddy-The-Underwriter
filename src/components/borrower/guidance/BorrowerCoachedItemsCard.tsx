"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerGuidanceItem } from "@/lib/borrower/buildBorrowerGuidanceViewModel";

function CoachedItem({ item }: { item: BorrowerGuidanceItem }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasDetails =
    item.whyItMatters || item.helpfulUploadHint || item.commonIssueToAvoid;

  return (
    <li className="rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span className="text-sm font-semibold text-slate-900">
                {item.label}
              </span>
            </div>
            <p className="mt-1 pl-4 text-sm text-slate-600">
              {item.explanation}
            </p>
          </div>
          {item.href && (
            <a
              href={item.href}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl brand-gradient-cta px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
            >
              Upload
              <Icon name="arrow_forward_ios" className="h-3 w-3 text-current" />
            </a>
          )}
        </div>

        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 ml-4 text-xs font-medium text-sky-700 hover:text-sky-900"
          >
            {expanded ? "Hide details" : "Why this matters"}
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-2">
          {item.whyItMatters && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Why it matters
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{item.whyItMatters}</p>
            </div>
          )}
          {item.helpfulUploadHint && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                What a helpful upload looks like
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{item.helpfulUploadHint}</p>
            </div>
          )}
          {item.commonIssueToAvoid && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Common issue to avoid
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{item.commonIssueToAvoid}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function BorrowerCoachedItemsCard({
  items,
}: {
  items: BorrowerGuidanceItem[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-amber-200/60 bg-[linear-gradient(135deg,_rgba(255,251,235,0.5)_0%,_rgba(254,249,195,0.2)_100%)] p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
          <Icon name="description" className="h-4 w-4 text-amber-700" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-amber-900">
          Items That Will Help Most
        </h3>
      </div>
      <p className="mt-2 text-xs text-amber-700/80">
        These are the highest-impact items for moving your package forward.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <CoachedItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
