// src/components/home/CommandBridgeShell.tsx
import Link from "next/link";
import React from "react";

export function CommandBridgeShell(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(59,130,246,0.18),transparent_55%),radial-gradient(900px_500px_at_80%_0%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(2,6,23,1))] text-slate-100">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BuddyMark />
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wide text-white">Buddy Underwriter</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200">
                  Command Bridge
                </span>
              </div>
              <div className="text-xs text-slate-300">AI credit intelligence across your pipeline</div>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <Link href="/deals" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              Deals
            </Link>
            <Link href="/evidence/inbox" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              Evidence
            </Link>
            <Link href="/portal" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              Portal
            </Link>
            <Link href="/ops" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
              Ops
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 pb-10 pt-8">{props.children}</main>
    </div>
  );
}

function BuddyMark() {
  return (
    <div className="relative h-10 w-10">
      <div className="absolute inset-0 rounded-2xl bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" />
      <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.35),transparent_50%),radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.25),transparent_55%)]" />
      <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
      <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border border-white/15" />
    </div>
  );
}
