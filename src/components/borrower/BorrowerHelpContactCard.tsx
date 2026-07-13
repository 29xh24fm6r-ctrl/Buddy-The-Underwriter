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
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
          <Icon name="person" className="h-5 w-5 text-slate-700" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Need help?
          </div>
          <h2 className="mt-2 font-heading text-xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">{body}</p>
          <a
            href={actionHref}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            {actionLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
