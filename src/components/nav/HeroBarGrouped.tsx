"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  extractDealIdFromPath,
  getLastDealId,
  setLastDealId,
  resolveDealScopedRoute,
  type DealScopedTarget,
} from "@/lib/navigation/resolveDealScopedRoute";
import { DealPickerModal } from "@/components/nav/DealPickerModal";

function cls(active: boolean) {
  return [
    "px-3 py-1.5 rounded-full text-sm",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBarGrouped() {
  const pathname = usePathname();
  const safePathname = pathname ?? "";
  const [pickerTarget, setPickerTarget] = React.useState<DealScopedTarget | null>(null);

  const activeDealId = extractDealIdFromPath(safePathname);
  React.useEffect(() => {
    if (activeDealId) setLastDealId(activeDealId);
  }, [activeDealId]);

  const lastDealId = getLastDealId();

  function dealNav(target: DealScopedTarget, label: string) {
    const { href } = resolveDealScopedRoute({ pathname: safePathname, target, lastDealId });
    if (href) {
      return (
        <Link key={target} href={href} className={cls(safePathname.startsWith(href))}>
          {label}
        </Link>
      );
    }
    return (
      <button
        key={target}
        type="button"
        onClick={() => setPickerTarget(target)}
        className={cls(false)}
        title="Select a deal to open"
      >
        {label}
      </button>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/deals" className="text-white font-semibold tracking-tight">
              Buddy <span className="text-white/60">The Underwriter</span>
            </Link>

            <div className="hidden lg:flex items-center gap-6">
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 px-2">Acquire</span>
                <Link href="/deals" className={cls(safePathname.startsWith("/deals"))}>Deals</Link>
                <Link href="/documents" className={cls(safePathname.startsWith("/documents"))}>Documents</Link>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 px-2">Decide</span>
                {dealNav("underwrite", "Underwrite")}
                {dealNav("pricing", "Pricing")}
                {dealNav("credit-memo", "Credit Memo")}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-white/40 px-2">Operate</span>
                <Link href="/servicing" className={cls(safePathname.startsWith("/servicing"))}>Servicing</Link>
                <Link href="/admin" className={cls(safePathname.startsWith("/admin"))}>Admin</Link>
              </div>
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
            <Link href="/deals" className={cls(safePathname.startsWith("/deals"))}>Deals</Link>
            <Link href="/documents" className={cls(safePathname.startsWith("/documents"))}>Documents</Link>
            {dealNav("underwrite", "Underwrite")}
            {dealNav("pricing", "Pricing")}
            {dealNav("credit-memo", "Credit Memo")}
            <Link href="/servicing" className={cls(safePathname.startsWith("/servicing"))}>Servicing</Link>
            <Link href="/admin" className={cls(safePathname.startsWith("/admin"))}>Admin</Link>
          </div>
        </div>
      </div>

      {pickerTarget && (
        <DealPickerModal target={pickerTarget} onClose={() => setPickerTarget(null)} />
      )}
    </>
  );
}
