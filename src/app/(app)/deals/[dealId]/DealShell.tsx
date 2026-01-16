"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { sampleDeals } from "@/lib/deals/sampleDeals";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import { resolveDealLabel } from "@/lib/deals/dealLabel";

function getDealById(id: string) {
  return sampleDeals.find((d) => d.id === id) ?? null;
}

function formatAmount(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function Tab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "px-3 py-2 rounded-lg text-sm whitespace-nowrap border transition-colors",
        active
          ? "bg-white/10 text-white border-white/15"
          : "text-white/70 border-white/10 hover:text-white hover:bg-white/5",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function DealShell({
  dealId,
  children,
}: {
  dealId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const deal = dealId ? getDealById(dealId) : null;
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [borrowerName, setBorrowerName] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) return;
    if (typeof window === "undefined") return;
    try {
      const label = resolveDealLabel({
        id: dealId,
        display_name: displayName,
        nickname,
        borrower_name: borrowerName ?? deal?.name ?? null,
        name: deal?.name ?? null,
      }).label;
      const payload = {
        dealId,
        dealName: label ?? null,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem("lastActiveDeal", JSON.stringify(payload));
    } catch (e) {
      console.warn("[DealShell] Failed to store last active deal", e);
    }
  }, [dealId, deal?.name, displayName, nickname, borrowerName]);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    fetch(`/api/deals/${dealId}/name`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setDisplayName(json.display_name ?? null);
        setNickname(json.nickname ?? null);
        setBorrowerName(json.borrower_name ?? null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const base = `/deals/${dealId}`;

  const tabs = [
    { label: "Overview", href: `/underwrite/${dealId}` },
    { label: "Documents", href: `${base}/borrower-inbox` },
    { label: "Pricing", href: `${base}/pricing-memo` },
    { label: "Memo", href: `${base}/memo-template` },
    { label: "Terms", href: `${base}/loan-terms` },
    { label: "Borrower", href: `${base}/borrower` },
    { label: "Portal", href: `${base}/portal-inbox` },
  ];

  return (
    <div className="min-h-screen bg-[#0b0d10] text-white">
      {/* Deal header */}
      <div className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto max-w-[1600px] px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/deals"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/5 border border-white/10"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                arrow_back
              </span>
              Deals
            </Link>

            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                <DealNameInlineEditor
                  dealId={dealId}
                  displayName={displayName}
                  nickname={nickname}
                  borrowerName={borrowerName ?? deal?.name ?? null}
                  size="sm"
                  onUpdated={(next) => {
                    setDisplayName(next.displayName ?? null);
                    setNickname(next.nickname ?? null);
                  }}
                />
              </div>
              <div className="text-xs text-white/60 truncate">
                {deal ? deal.subtitle : "Loading deal context..."}
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-white/70">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Loan</div>
              <div className="text-sm font-semibold text-white">
                {deal ? formatAmount(deal.amount) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Status</div>
              <div className="text-sm font-semibold text-white">{deal?.stage ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Risk</div>
              <div className="text-sm font-semibold text-white">{deal?.riskRating ?? "—"}</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-[1600px] px-6 pb-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <Tab
                key={t.href}
                href={t.href}
                label={t.label}
                active={pathname === t.href || pathname.startsWith(t.href + "/")}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-[1600px]">{children}</div>
    </div>
  );
}
