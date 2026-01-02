"use client";

import Link from "next/link";

export function Close() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="rounded-3xl border p-10 shadow-sm">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-8 space-y-3">
            <div className="text-3xl font-semibold tracking-tight">
              This is what underwriting looks like when it's a system.
            </div>
            <div className="text-muted-foreground">
              Evidence. Policy. Decision. Confidence. Overrides. Replay. All as a single audit-grade record.
            </div>
          </div>
          <div className="lg:col-span-4 flex flex-col gap-2">
            <Link className="rounded-2xl border px-5 py-3 text-sm font-medium hover:bg-muted text-center"  href="/deals">
              Open Buddy
            </Link>
            <div className="text-xs text-muted-foreground text-center">
              (Your app is the proof.)
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
