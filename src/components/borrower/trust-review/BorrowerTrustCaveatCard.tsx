"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerTrustCaveatCard({
  message,
}: {
  message: string;
}) {
  return (
    <section
      role="note"
      aria-label="Package preparation caveat"
      className="rounded-[1.5rem] border border-stone-200 bg-stone-50/60 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white">
          <Icon name="auto_awesome" className="h-4 w-4 text-stone-700" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">
            How Buddy uses what you've shared
          </h3>
          <p className="mt-1 text-sm leading-6 text-stone-700">{message}</p>
          <p className="mt-2 text-xs leading-5 text-stone-600">
            Reviewing your details here helps Buddy prepare the lender package
            — it isn't a lending decision and doesn't change how a lender will
            review the request.
          </p>
        </div>
      </div>
    </section>
  );
}
