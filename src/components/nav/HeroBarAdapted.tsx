"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";

/**
 * HeroBar adapted to your existing route structure
 * Uses actual routes that exist in the codebase
 */

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; query?: string }>;
}> = [
  {
    label: "Acquire",
    items: [
      { href: "/deals", label: "Deals" },
      { href: "/borrower", label: "Borrower Portal" },
      { href: "/portal/documents", label: "Documents" },
    ],
  },
  {
    label: "Decide",
    items: [
      { href: "/deals", label: "Underwrite", query: "?tab=underwriter" },
      { href: "/deals", label: "Pricing", query: "?tab=sba" },
      { href: "/deals", label: "Credit Memo", query: "?tab=memo" },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/servicing", label: "Servicing" },
      { href: "/admin/templates", label: "Admin" },
    ],
  },
];

function cls(active: boolean) {
  return [
    "px-3 py-1.5 rounded-full text-sm whitespace-nowrap",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBarAdapted() {
  const pathname = usePathname();
  const params = useParams();
  const dealId = params?.dealId as string | undefined;

  // For deal-specific pages, show deal-level actions
  const isDealPage = pathname.includes("/deals/") && dealId;

  return (
    <div className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/deals" className="text-white font-semibold tracking-tight">
            Buddy <span className="text-white/60">The Underwriter</span>
          </Link>

          {/* Deal-level nav when on a deal page */}
          {isDealPage && (
            <div className="hidden lg:flex items-center gap-1 border-l border-white/10 pl-4">
              <Link href={`/deals/${dealId}`} className={cls(pathname === `/deals/${dealId}`)}>
                Overview
              </Link>
              <Link href={`/deals/${dealId}/underwrite`} className={cls(pathname.includes("/underwrite"))}>
                Underwrite
              </Link>
              <Link href={`/deals/${dealId}/sba`} className={cls(pathname.includes('/sba'))}>
                SBA/Pricing
              </Link>
              <Link href={`/deals/${dealId}/borrower`} className={cls(pathname.includes('/borrower'))}>
                Borrower
              </Link>
              <Link href={`/deals/${dealId}/borrower-inbox`} className={cls(pathname.includes('/borrower-inbox'))}>
                Inbox
              </Link>
            </div>
          )}

          {/* Global nav when not on deal page */}
          {!isDealPage && (
            <div className="hidden lg:flex items-center gap-6">
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className="flex items-center gap-1">
                  <span className="text-xs text-white/40 px-2">{group.label}</span>
                  {group.items.map((item) => (
                    <Link
                      key={item.href + (item.query || '')}
                      href={item.href + (item.query || '')}
                      className={cls(pathname.startsWith(item.href))}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isDealPage && (
            <Link
              href={`/deals/${dealId}/cockpit`}
              className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white hover:border-white/30"
            >
              Command
            </Link>
          )}
          <Link
            href="/admin/templates"
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white hover:border-white/30"
          >
            Admin
          </Link>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden overflow-x-auto border-t border-white/10">
        <div className="flex gap-1 px-2 py-2">
          {isDealPage ? (
            <>
              <Link href={`/deals/${dealId}`} className={cls(pathname === `/deals/${dealId}`)}>
                Overview
              </Link>
              <Link href={`/deals/${dealId}/underwrite`} className={cls(pathname.includes("/underwrite"))}>
                Underwrite
              </Link>
              <Link href={`/deals/${dealId}/sba`} className={cls(pathname.includes('/sba'))}>
                SBA
              </Link>
              <Link href={`/deals/${dealId}/borrower`} className={cls(pathname.includes('/borrower'))}>
                Borrower
              </Link>
            </>
          ) : (
            NAV_GROUPS.flatMap((g) => g.items).map((n) => (
              <Link key={n.href + (n.query || '')} href={n.href + (n.query || '')} className={cls(pathname.startsWith(n.href))}>
                {n.label}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
