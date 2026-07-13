"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerNoActionReassurance({
  message,
}: {
  message: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-emerald-200/60 bg-emerald-50/40 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/80">
          <Icon name="check_circle" className="h-4 w-4 text-emerald-600" />
        </div>
        <h3 className="font-heading text-sm font-semibold text-emerald-900">
          No borrower action needed
        </h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{message}</p>
    </section>
  );
}
