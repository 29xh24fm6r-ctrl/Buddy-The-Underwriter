"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useProfile } from "@/hooks/useProfile";
import {
  extractDealIdFromPath,
  getLastDealId,
  setLastDealId,
  resolveDealScopedRoute,
  type DealScopedTarget,
} from "@/lib/navigation/resolveDealScopedRoute";
import { DealPickerModal } from "@/components/nav/DealPickerModal";

// Static nav items (always global)
const STATIC_NAV = [
  { href: "/deals", label: "Deals" },
  { href: "/documents", label: "Documents" },
  { href: "/servicing", label: "Servicing" },
  { href: "/admin", label: "Admin" },
];

// Deal-scoped nav items
const DEAL_SCOPED_ITEMS: Array<{ target: DealScopedTarget; label: string }> = [
  { target: "underwrite", label: "Underwrite" },
  { target: "pricing", label: "Pricing" },
  { target: "credit-memo", label: "Credit Memo" },
];

function cls(active: boolean, disabled?: boolean) {
  if (disabled) {
    return "px-3 py-1.5 rounded-full text-sm text-white/30 cursor-not-allowed";
  }
  return [
    "px-3 py-1.5 rounded-full text-sm",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBar() {
  const pathname = usePathname();
  const safePathname = pathname ?? "";
  const { profile, currentBank, schemaMismatch } = useProfile();
  const { signOut } = useClerk();

  const [pickerTarget, setPickerTarget] = React.useState<DealScopedTarget | null>(null);

  // Persist lastDealId whenever inside a deal route
  const activeDealId = extractDealIdFromPath(safePathname);
  React.useEffect(() => {
    if (activeDealId) setLastDealId(activeDealId);
  }, [activeDealId]);

  const lastDealId = getLastDealId();

  // Resolve deal-scoped nav items
  const resolvedDealNav = DEAL_SCOPED_ITEMS.map((item) => {
    const resolution = resolveDealScopedRoute({
      pathname: safePathname,
      target: item.target,
      lastDealId,
    });
    return { ...item, ...resolution };
  });

  function handleDealScopedClick(
    e: React.MouseEvent,
    item: typeof resolvedDealNav[number],
  ) {
    if (item.href) return; // Let the <a> navigate normally
    e.preventDefault();
    setPickerTarget(item.target);
  }

  const initials = profile?.display_name
    ? profile.display_name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  function renderDealNavItem(item: typeof resolvedDealNav[number]) {
    const isActive =
      item.href ? safePathname.startsWith(item.href) : false;

    if (item.href) {
      return (
        <Link key={item.target} href={item.href} className={cls(isActive)}>
          {item.label}
        </Link>
      );
    }

    // No deal context — button that opens picker
    return (
      <button
        key={item.target}
        type="button"
        onClick={(e) => handleDealScopedClick(e, item)}
        className={cls(false, false)}
        title="Select a deal to open"
      >
        {item.label}
      </button>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/deals" className="text-white font-semibold tracking-tight">
              Buddy <span className="text-white/60">The Underwriter</span>
            </Link>
            {currentBank && (
              <div className="hidden sm:flex items-center gap-2 border-l border-white/10 pl-3">
                {currentBank.logo_url && (
                  <img
                    src={currentBank.logo_url}
                    alt=""
                    className="h-5 w-5 rounded object-contain bg-white/10"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <span className="text-xs text-white/50">{currentBank.name}</span>
              </div>
            )}

            <div className="hidden md:flex items-center gap-1">
              {STATIC_NAV.slice(0, 2).map((n) => (
                <Link key={n.href} href={n.href} className={cls(safePathname.startsWith(n.href))}>
                  {n.label}
                </Link>
              ))}
              {resolvedDealNav.map(renderDealNavItem)}
              {STATIC_NAV.slice(2).map((n) => (
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
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:text-white hover:border-white/30"
              title="Sign out"
              aria-label="Sign out"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>logout</span>
            </button>
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
            {STATIC_NAV.slice(0, 2).map((n) => (
              <Link key={n.href} href={n.href} className={cls(safePathname.startsWith(n.href))}>
                {n.label}
              </Link>
            ))}
            {resolvedDealNav.map(renderDealNavItem)}
            {STATIC_NAV.slice(2).map((n) => (
              <Link key={n.href} href={n.href} className={cls(safePathname.startsWith(n.href))}>
                {n.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Deal picker modal */}
      {pickerTarget && (
        <DealPickerModal
          target={pickerTarget}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </>
  );
}
