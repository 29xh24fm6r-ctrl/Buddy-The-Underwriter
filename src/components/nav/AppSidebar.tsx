"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STITCH_PAGES } from "@/lib/stitch/registry";

type Item = (typeof STITCH_PAGES)[number];

function hrefFor(p: Item) {
  return p.route ?? `/stitch/${p.slug}`;
}

function groupLabel(g?: string) {
  return g ?? "Other";
}

export default function AppSidebar() {
  const pathname = usePathname();

  const groups: Record<string, Item[]> = {};
  for (const p of STITCH_PAGES) {
    const g = groupLabel(p.group);
    (groups[g] ??= []).push(p);
  }

  const groupNames = Object.keys(groups).sort();

  return (
    <aside className="hidden lg:flex w-[280px] shrink-0 bg-[#0f1115] border-r border-white/10 flex-col overflow-y-auto">
      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-sm font-semibold tracking-wide text-white/90">
          Buddy — Pages
        </div>
        <div className="text-xs text-white/50 mt-1">
          Stitch exports + real routes
        </div>
      </div>

      <nav className="px-2 py-3 space-y-4">
        {groupNames.map((g) => (
          <div key={g}>
            <div className="px-2 py-2 text-[11px] uppercase tracking-wider text-white/40">
              {g}
            </div>

            <div className="space-y-1">
              {groups[g].map((p) => {
                const href = hrefFor(p);
                const active =
                  pathname === href ||
                  (href !== "/" && pathname?.startsWith(href + "/"));

                return (
                  <Link
                    key={p.slug}
                    href={href}
                    className={[
                      "block rounded-lg px-3 py-2 text-sm",
                      "hover:bg-white/5 hover:text-white",
                      active ? "bg-white/10 text-white" : "text-white/70",
                    ].join(" ")}
                  >
                    {p.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
