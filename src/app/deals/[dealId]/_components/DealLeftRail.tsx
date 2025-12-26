"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEAL_NAV } from "./dealNav";

function isActive(pathname: string, href: string) {
  if (href === `/deals/${pathname.split("/")[2]}`) {
    // Overview is exact match to /deals/:id
    return pathname === href;
  }
  return pathname.startsWith(href);
}

export default function DealLeftRail({ dealId }: { dealId: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-[280px] shrink-0 border-r border-border-dark bg-[#0f1115]">
      <div className="flex w-full flex-col px-3 py-4">
        <div className="px-2 pb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deal Workspace
          </div>
          <div className="mt-1 text-sm font-semibold">Command Center</div>
        </div>

        <nav className="flex flex-col gap-1">
          {DEAL_NAV.map((item) => {
            const href = item.href(dealId);
            const active = isActive(pathname, href);

            return (
              <Link
                key={item.key}
                href={href}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  active
                    ? "bg-[#121622] text-white border border-border-dark"
                    : "text-muted-foreground hover:bg-[#121622]/60 hover:text-white",
                ].join(" ")}
              >
                {item.icon ? (
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                ) : (
                  <span className="h-[18px] w-[18px]" />
                )}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-2 pt-4">
          <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-3">
            <div className="text-xs font-semibold">Tip</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              This left rail is now the single source of truth for all deal routes.
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
