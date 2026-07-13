"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function BorrowerShell({
  hero,
  primary,
  rail,
  children,
  footer,
  mobileFooter,
}: {
  hero: React.ReactNode;
  primary?: React.ReactNode;
  rail?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  mobileFooter?: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#f6f8fb] text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="space-y-6">
          {hero}
          {primary ? <div>{primary}</div> : null}
          <div
            className={cn(
              "grid gap-6",
              rail ? "xl:grid-cols-[minmax(0,1fr)_320px]" : undefined,
            )}
          >
            <div className="min-w-0 space-y-6">{children}</div>
            {rail ? <aside className="min-w-0">{rail}</aside> : null}
          </div>
        </div>
        {footer}
      </div>
      {mobileFooter ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/96 p-4 shadow-[0_-12px_30px_rgba(15,23,42,0.10)] backdrop-blur sm:hidden">
          {mobileFooter}
        </div>
      ) : null}
    </main>
  );
}
