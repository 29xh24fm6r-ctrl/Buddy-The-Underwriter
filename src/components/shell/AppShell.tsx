// src/components/shell/AppShell.tsx
import React from "react";
import Link from "next/link";

export function AppShell(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(59,130,246,0.14),transparent_55%),radial-gradient(900px_500px_at_80%_0%,rgba(16,185,129,0.10),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,1),rgba(2,6,23,1))] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/25 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-9 rounded-2xl bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.35),transparent_50%),radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.25),transparent_55%)]" />
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/75" />
              <div className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border border-white/15" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">Buddy Underwriter</div>
              <div className="text-xs text-slate-300">AI Credit Intelligence</div>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <NavLink href="/deals" label="Home" />
            <NavLink href="/deals" label="Deals" />
            <NavLink href="/evidence/inbox" label="Evidence" />
            <NavLink href="/portal" label="Portal" />
            <NavLink href="/ops" label="Ops" />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-3xl border border-white/10 bg-white/4 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
    >
      {label}
    </Link>
  );
}
