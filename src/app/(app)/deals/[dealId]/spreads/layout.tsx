"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

const SPREAD_TABS = [
  { key: "business", label: "Business Spreads", href: "business", icon: "analytics" },
  { key: "personal-income", label: "Personal Income", href: "personal-income", icon: "person" },
  { key: "personal-financial-statement", label: "PFS", href: "personal-financial-statement", icon: "account_balance" },
  { key: "global-cash-flow", label: "Global Cash Flow", href: "global-cash-flow", icon: "public" },
] as const;

export default function SpreadsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const pathname = usePathname() ?? "";

  // Extract dealId from pathname since this is a client component
  const match = pathname.match(/\/deals\/([^/]+)\/spreads/);
  const dealId = match?.[1] ?? "";
  const base = `/deals/${dealId}/spreads`;

  return (
    <div className="px-6 py-6">
      {/* Tab navigation */}
      <div className="mb-6 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {SPREAD_TABS.map((tab) => {
          const tabHref = `${base}/${tab.href}`;
          const active = pathname === tabHref || pathname.startsWith(tabHref + "/");

          return (
            <Link
              key={tab.key}
              href={tabHref}
              className={cn(
                "inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-white/10 text-white/60 hover:bg-white/5 hover:text-white/80",
              )}
            >
              <Icon name={tab.icon} className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
