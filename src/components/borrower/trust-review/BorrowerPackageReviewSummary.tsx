"use client";

import { Icon } from "@/components/ui/Icon";
import type { BorrowerPackageReviewSummary } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";

export function BorrowerPackageReviewSummary({
  summary,
}: {
  summary: BorrowerPackageReviewSummary;
}) {
  return (
    <section
      role="region"
      aria-label="Package review summary"
      className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name="file" className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">
          Package review summary
        </h3>
      </div>

      <dl
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-label="Package counts"
      >
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-emerald-900">
            Required received
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-emerald-900">
            {summary.requiredReceived}
          </dd>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-sky-900">
            Required remaining
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-sky-900">
            {summary.requiredRemaining}
          </dd>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
            Needs attention
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-amber-900">
            {summary.needsAttention}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Categories received
        </div>
        {summary.categoriesReceived.length === 0 ? (
          <p className="mt-1 text-sm italic text-slate-600">
            No categories received yet.
          </p>
        ) : (
          <ul
            className="mt-1 flex flex-wrap gap-1.5"
            role="list"
            aria-label="Received document categories"
          >
            {summary.categoriesReceived.map((category) => (
              <li
                key={category}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                />
                {category}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Submission readiness
        </div>
        <div className="mt-0.5 text-sm font-semibold text-slate-900">
          {summary.submissionReadinessLabel}
        </div>
      </div>
    </section>
  );
}
