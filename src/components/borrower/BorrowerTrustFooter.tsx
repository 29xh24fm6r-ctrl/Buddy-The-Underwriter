"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerTrustFooter() {
  return (
    <footer className="rounded-[1.5rem] border border-stone-200 bg-white/90 p-5 text-sm text-stone-600 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-100">
            <Icon name="fact_check" className="h-5 w-5 text-stone-700" />
          </div>
          <div>
            <div className="font-semibold text-stone-900">Secure SBA document portal</div>
            <p className="mt-1 max-w-2xl">
              Buddy keeps your package private, shares only what your lender needs,
              and never shows storage links or internal review notes in this portal.
            </p>
          </div>
        </div>
        <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
          Private link • touch-safe upload flow • borrower-only view
        </div>
      </div>
    </footer>
  );
}
