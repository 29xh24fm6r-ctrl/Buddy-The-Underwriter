"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_GROUPS = [
  {
    label: "Acquire",
    items: [
      { href: "/deals", label: "Deals" },
      { href: "/borrower-portal", label: "Borrower Portal" },
      { href: "/documents", label: "Documents" },
    ],
  },
  {
    label: "Decide",
    items: [
      { href: "/underwrite", label: "Underwrite" },
      { href: "/pricing", label: "Pricing" },
      { href: "/credit-memo", label: "Credit Memo" },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/servicing", label: "Servicing" },
      { href: "/admin", label: "Admin" },
    ],
  },
];

function cls(active: boolean) {
  return [
    "px-3 py-1.5 rounded-full text-sm",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBarGrouped() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/deals" className="text-white font-semibold tracking-tight">
            Buddy <span className="text-white/60">The Underwriter</span>
          </Link>

          <div className="hidden lg:flex items-center gap-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="flex items-center gap-1">
                <span className="text-xs text-white/40 px-2">{group.label}</span>
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} className={cls(pathname.startsWith(item.href))}>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/command"
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white hover:border-white/30"
          >
            Command
          </Link>
          <Link
            href="/settings"
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white hover:border-white/30"
          >
            Settings
          </Link>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden overflow-x-auto border-t border-white/10">
        <div className="flex gap-1 px-2 py-2">
          {NAV_GROUPS.flatMap((g) => g.items).map((n) => (
            <Link key={n.href} href={n.href} className={cls(pathname.startsWith(n.href))}>
              {n.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
