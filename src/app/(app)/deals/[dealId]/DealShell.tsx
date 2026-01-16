"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { Icon } from "@/components/ui/Icon";

function formatAmount(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

type DealShellDeal = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  borrower_name: string | null;
  name: string | null;
  amount: number | null;
  stage: string | null;
  risk_score: number | null;
};

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
  deal,
  children,
}: {
  dealId: string;
  deal: DealShellDeal | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [nameOverride, setNameOverride] = useState<{
    displayName: string | null;
    nickname: string | null;
  } | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const displayName = nameOverride?.displayName ?? deal?.display_name ?? null;
  const nickname = nameOverride?.nickname ?? deal?.nickname ?? null;
  const borrowerName = deal?.borrower_name ?? deal?.name ?? null;

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

  function handleCopyDealId() {
    if (!dealId) return;
    navigator.clipboard
      .writeText(dealId)
      .then(() => setCopyToast("Copied"))
      .catch(() => setCopyToast("Copy failed"))
      .finally(() => window.setTimeout(() => setCopyToast(null), 1200));
  }

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
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit items-center rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                  Deal workspace
                </span>
                {borrowerName ? (
                  <span className="text-xs text-white/60 truncate">{borrowerName}</span>
                ) : (
                  <span className="text-xs text-white/40 truncate">Borrower not set</span>
                )}
                <button
                  type="button"
                  onClick={handleCopyDealId}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                >
                  <Icon name="description" className="h-3.5 w-3.5" />
                  {copyToast ?? "Copy ID"}
                </button>
              </div>

              <div className="mt-1 min-w-0">
                <DealNameInlineEditor
                  dealId={dealId}
                  displayName={displayName}
                  nickname={nickname}
                  borrowerName={borrowerName ?? deal?.name ?? null}
                  size="lg"
                  tone="dark"
                  onUpdated={(next) => {
                    setNameOverride({
                      displayName: next.displayName ?? null,
                      nickname: next.nickname ?? null,
                    });
                  }}
                />
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-white/70">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Loan</div>
              <div className="text-sm font-semibold text-white">
                {deal?.amount != null ? formatAmount(deal.amount) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Status</div>
              <div className="text-sm font-semibold text-white">{deal?.stage ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/50">Risk</div>
              <div className="text-sm font-semibold text-white">
                {deal?.risk_score != null ? String(deal.risk_score) : "—"}
              </div>
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
