"use client";

import { Icon } from "@/components/ui/Icon";

export function BorrowerSecurityNotice() {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100">
          <Icon name="fact_check" className="h-5 w-5 text-stone-700" />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Security and privacy
          </div>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">
            Secure SBA document portal
          </h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-stone-700">
            <li>Files are encrypted in transit when you upload them.</li>
            <li>Only your SBA team can access these documents in this portal.</li>
            <li>Buddy does not expose storage links or internal review notes here.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
