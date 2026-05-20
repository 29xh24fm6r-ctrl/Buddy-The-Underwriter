"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  setLastDealId,
  getLastDealId,
  resolveDealScopedRoute,
  type DealScopedTarget,
} from "@/lib/navigation/resolveDealScopedRoute";
import { DealPickerModal } from "@/components/nav/DealPickerModal";

function cls(active: boolean) {
  return [
    "px-3 py-1.5 rounded-full text-sm whitespace-nowrap",
    active ? "bg-white/10 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
  ].join(" ");
}

export function HeroBarAdapted() {
  const pathname = usePathname();
  const params = useParams();
  const safePathname = pathname ?? "";
  const dealId = params?.dealId as string | undefined;
  const isDealPage = safePathname.includes("/deals/") && dealId;
  const [pickerTarget, setPickerTarget] = React.useState<DealScopedTarget | null>(null);

  // Persist lastDealId
  React.useEffect(() => {
    if (dealId) setLastDealId(dealId);
  }, [dealId]);

  const lastDealId = getLastDealId();

  function globalDealNav(target: DealScopedTarget, label: string) {
    const { href } = resolveDealScopedRoute({ pathname: safePathname, target, lastDealId });
    if (href) {
      return (
        <Link key={target} href={href} className={cls(safePathname.includes(`/${target}`))}>
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

            {/* Deal-level nav when on a deal page */}
            {isDealPage && (
              <div className="hidden lg:flex items-center gap-1 border-l border-white/10 pl-4">
                <Link href={`/deals/${dealId}`} className={cls(safePathname === `/deals/${dealId}`)}>
                  Overview
                </Link>
                <Link href={`/deals/${dealId}/underwrite`} className={cls(safePathname.includes("/underwrite"))}>
                  Underwrite
                </Link>
                <Link href={`/deals/${dealId}/sba`} className={cls(safePathname.includes("/sba"))}>
                  SBA/Pricing
                </Link>
                <Link href={`/deals/${dealId}/credit-memo`} className={cls(safePathname.includes("/credit-memo"))}>
                  Credit Memo
                </Link>
                <Link href={`/deals/${dealId}/borrower`} className={cls(safePathname.includes("/borrower"))}>
                  Borrower
                </Link>
                <Link href={`/deals/${dealId}/borrower-inbox`} className={cls(safePathname.includes("/borrower-inbox"))}>
                  Inbox
                </Link>
              </div>
            )}

            {/* Global nav when not on deal page — deal-scoped items use resolver */}
            {!isDealPage && (
              <div className="hidden lg:flex items-center gap-6">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-white/40 px-2">Acquire</span>
                  <Link href="/deals" className={cls(safePathname.startsWith("/deals"))}>Deals</Link>
                  <Link href="/borrower" className={cls(safePathname.startsWith("/borrower"))}>Borrower Portal</Link>
                  <Link href="/portal/documents" className={cls(safePathname.startsWith("/portal/documents"))}>Documents</Link>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-white/40 px-2">Decide</span>
                  {globalDealNav("underwrite", "Underwrite")}
                  {globalDealNav("pricing", "Pricing")}
                  {globalDealNav("credit-memo", "Credit Memo")}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-white/40 px-2">Operate</span>
                  <Link href="/servicing" className={cls(safePathname.startsWith("/servicing"))}>Servicing</Link>
                  <Link href="/admin/templates" className={cls(safePathname.startsWith("/admin"))}>Admin</Link>
                </div>
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
                <Link href={`/deals/${dealId}`} className={cls(safePathname === `/deals/${dealId}`)}>
                  Overview
                </Link>
                <Link href={`/deals/${dealId}/underwrite`} className={cls(safePathname.includes("/underwrite"))}>
                  Underwrite
                </Link>
                <Link href={`/deals/${dealId}/sba`} className={cls(safePathname.includes("/sba"))}>
                  SBA
                </Link>
                <Link href={`/deals/${dealId}/credit-memo`} className={cls(safePathname.includes("/credit-memo"))}>
                  Memo
                </Link>
                <Link href={`/deals/${dealId}/borrower`} className={cls(safePathname.includes("/borrower"))}>
                  Borrower
                </Link>
              </>
            ) : (
              <>
                <Link href="/deals" className={cls(safePathname.startsWith("/deals"))}>Deals</Link>
                {globalDealNav("underwrite", "Underwrite")}
                {globalDealNav("pricing", "Pricing")}
                {globalDealNav("credit-memo", "Credit Memo")}
                <Link href="/servicing" className={cls(safePathname.startsWith("/servicing"))}>Servicing</Link>
              </>
            )}
          </div>
        </div>
      </div>

      {pickerTarget && (
        <DealPickerModal target={pickerTarget} onClose={() => setPickerTarget(null)} />
      )}
    </>
  );
}
