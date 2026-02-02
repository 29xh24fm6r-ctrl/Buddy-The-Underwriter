"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";

const NAV = [
  { href: "/deals", label: "Deals" },
  { href: "/borrower-portal", label: "Borrower Portal" },
  { href: "/documents", label: "Documents" },
  { href: "/underwrite", label: "Underwrite" },
  { href: "/pricing", label: "Pricing" },
  { href: "/credit-memo", label: "Credit Memo" },
  { href: "/servicing", label: "Servicing" },
  { href: "/admin", label: "Admin" },
];

function cls(active: boolean) {
  return [
    "px-3 py-1.5 rounded-full text-sm",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBar() {
  const pathname = usePathname();
  const safePathname = pathname ?? "";
  const { profile, currentBank, schemaMismatch } = useProfile();

  const initials = profile?.display_name
    ? profile.display_name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  return (
    <div className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/deals" className="text-white font-semibold tracking-tight">
            Buddy <span className="text-white/60">The Underwriter</span>
          </Link>
          {currentBank && (
            <span className="hidden sm:inline text-xs text-white/50 border-l border-white/10 pl-3">
              {currentBank.name}
            </span>
          )}

          <div className="hidden md:flex items-center gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cls(safePathname.startsWith(n.href))}>
                {n.label}
              </Link>
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
          <span className="hidden sm:inline text-[10px] text-white/30 font-mono">
            {process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev"}
          </span>
          <Link href="/profile" className="relative shrink-0 group" aria-label="Profile">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover border border-white/20"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20 text-xs font-bold text-white/80">
                {initials ?? "?"}
              </div>
            )}
            {schemaMismatch && (
              <span
                className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-amber-400 border border-black"
                title="Profile schema pending migration"
              />
            )}
          </Link>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="md:hidden overflow-x-auto border-t border-white/10">
        <div className="flex gap-1 px-2 py-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cls(safePathname.startsWith(n.href))}>
              {n.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
