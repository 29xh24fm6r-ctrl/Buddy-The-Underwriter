"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerEmptyState({
  title,
  message,
  ctaLabel,
  onClick,
}: {
  title: string;
  message: string;
  ctaLabel?: string;
  onClick?: () => void;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
        <Icon name="description" className="h-5 w-5 text-slate-700" />
      </div>
      <h3 className="mt-4 font-heading text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
      {ctaLabel && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl brand-gradient-cta px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
