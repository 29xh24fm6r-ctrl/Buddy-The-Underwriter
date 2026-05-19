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
    <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50/80 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
        <Icon name="description" className="h-5 w-5 text-stone-700" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-stone-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{message}</p>
      {ctaLabel && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
