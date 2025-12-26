"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type DealHeroBarProps = {
  dealId: string;
  borrowerName?: string;
  status?: string;
};

export default function DealHeroBar({ dealId, borrowerName, status }: DealHeroBarProps) {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-30 w-full border-b border-border-dark bg-[#0b0d10]/95 backdrop-blur">
      <div className="mx-auto max-w-[1400px] px-4">
        <div className="flex h-14 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/deals"
              className="inline-flex items-center gap-2 rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Deals
            </Link>

            <div className="h-6 w-px bg-border-dark" />

            <div className="flex flex-col leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Deal {dealId}</span>
                {status ? (
                  <span className="rounded-full border border-border-dark bg-[#0f1115] px-2 py-0.5 text-[11px] text-muted-foreground">
                    {status}
                  </span>
                ) : null}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {borrowerName ? borrowerName : "Borrower (mock)"} • {pathname}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]">
              Request docs
            </button>
            <button className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]">
              Generate memo
            </button>
            <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
