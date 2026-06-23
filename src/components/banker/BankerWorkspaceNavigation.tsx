"use client";

import { cn } from "@/lib/cn";
import type { BankerWorkspaceNavItem } from "@/lib/banker/buildDealIntelligenceWorkspace";

export function BankerWorkspaceNavigation({
  items,
}: {
  items: BankerWorkspaceNavItem[];
}) {
  const visible = items.filter((i) => i.visible);
  if (visible.length === 0) return null;

  return (
    <nav
      role="navigation"
      aria-label="Banker deal workspace navigation"
      className="sticky top-2 z-10 rounded-2xl border border-white/10 bg-stone-950/80 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-stone-950/70"
    >
      <ul
        className="flex flex-wrap items-center gap-1 overflow-x-auto"
        role="list"
        aria-label="Workspace sections"
      >
        {visible.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-label={`Jump to ${item.label}`}
              className={cn(
                "inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/80 transition hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
