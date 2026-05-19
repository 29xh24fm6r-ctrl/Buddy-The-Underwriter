"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerHelpContactCard({
  title,
  body,
  actionLabel,
  actionHref,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100">
          <Icon name="person" className="h-5 w-5 text-stone-700" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Need help?
          </div>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">{body}</p>
          <a
            href={actionHref}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50"
          >
            {actionLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
