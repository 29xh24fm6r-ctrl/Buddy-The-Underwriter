"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { Icon } from "@/components/ui/Icon";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";
import { useFinancialSnapshot } from "@/hooks/useFinancialSnapshot";
import { useFinancialSnapshotDecision } from "@/hooks/useFinancialSnapshotDecision";
import { useLenderMatches } from "@/hooks/useLenderMatches";

function fmtNum(n: number, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(0)}%`;
}

function fmtCurrencyCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function SnapMetric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-1" title={title}>
      <span className="text-[10px] uppercase tracking-wide text-white/50">{label}</span>
      <span className="text-xs font-semibold text-white">{value}</span>
    </div>
  );
}

function FinancialSnapshotCapsule({ dealId }: { dealId: string }) {
  const { data, loading, error, notFound } = useFinancialSnapshot(dealId);
  const decision = useFinancialSnapshotDecision(dealId);

  if (notFound) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-xs text-white/60">Snapshot…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <span className="text-xs text-white/60">Snapshot unavailable</span>
      </div>
    );
  }

  const s = data?.snapshot;
  if (!s) return null;

  const missingCount = s.missing_required_keys?.length ?? 0;
  const ready = missingCount === 0 && (s.completeness_pct ?? 0) >= 99.9;
  const badge = ready
    ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
    : "bg-amber-600/20 text-amber-200 border-amber-500/30";

  const dscr = s.dscr?.value_num;
  const dscrStressed = s.dscr_stressed_300bps?.value_num;
  const noi = s.noi_ttm?.value_num;
  const ltvNet = s.ltv_net?.value_num;
  const ltvGross = s.ltv_gross?.value_num;
  const occ = s.occupancy_pct?.value_num;
  const rent = s.in_place_rent_mo?.value_num;
  const sbaStatus = decision.data?.decision?.sba_json?.status ?? null;
  const sbaReasons = decision.data?.decision?.sba_json?.reasons ?? [];

  const sbaBadge = (() => {
    if (!sbaStatus) return null;
    if (sbaStatus === "eligible") return "bg-emerald-600/20 text-emerald-300 border-emerald-500/30";
    if (sbaStatus === "ineligible") return "bg-rose-600/20 text-rose-200 border-rose-500/30";
    return "bg-amber-600/20 text-amber-200 border-amber-500/30";
  })();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", badge].join(" ")}
        title={`Completeness: ${s.completeness_pct?.toFixed?.(1) ?? s.completeness_pct}% — Missing: ${missingCount}`}
      >
        {ready ? "Ready" : `Partial (${missingCount})`}
      </span>

      {sbaBadge ? (
        <span
          className={[
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            sbaBadge,
          ].join(" ")}
          title={
            Array.isArray(sbaReasons) && sbaReasons.length
              ? `SBA: ${sbaStatus}. ${sbaReasons.join(" ")}`
              : `SBA: ${sbaStatus}`
          }
        >
          SBA {sbaStatus === "eligible" ? "Eligible" : sbaStatus === "ineligible" ? "Ineligible" : "Conditional"}
        </span>
      ) : null}

      <SnapMetric
        label="DSCR"
        value={dscr == null ? "Pending" : fmtNum(dscr, 2)}
        title={dscrStressed == null ? undefined : `Stressed (+300bps): ${fmtNum(dscrStressed, 2)}`}
      />
      <SnapMetric label="NOI" value={noi == null ? "Pending" : fmtCurrencyCompact(noi)} title="TTM" />
      <SnapMetric
        label="LTV"
        value={ltvNet == null ? "Pending" : fmtPct(ltvNet)}
        title={ltvGross == null ? undefined : `Gross LTV: ${fmtPct(ltvGross)}`}
      />
      <SnapMetric label="Occ" value={occ == null ? "Pending" : fmtPct(occ)} />
      <SnapMetric label="Rent/mo" value={rent == null ? "Pending" : fmtCurrencyCompact(rent)} />
      <SnapMetric label="As of" value={s.as_of_date ?? "—"} />
    </div>
  );
}

function MatchedLendersCapsule({ dealId }: { dealId: string }) {
  const { data, loading } = useLenderMatches(dealId);
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <span className="text-xs text-white/60">Lenders…</span>
      </div>
    );
  }

  const matched = data?.matches?.matched ?? [];
  if (!matched.length) return null;

  const top = matched[0];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-xs text-white/60">Lenders</span>
      <span className="text-xs font-semibold text-white">{matched.length}</span>
      <span className="text-xs text-white/60">Top:</span>
      <span className="text-xs font-semibold text-white">{top?.lender ?? "—"}</span>
    </div>
  );
}

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
  legal_name?: string | null;
  amount: number | null;
  stage: string | null;
  risk_score: number | null;
};

type CanonicalMemoHeaderStatus = {
  status: "pending" | "partial" | "ready" | "error";
  last_generated_at: string | null;
} | null;

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
  canonicalMemoStatus,
  children,
}: {
  dealId: string;
  deal: DealShellDeal | null;
  canonicalMemoStatus?: CanonicalMemoHeaderStatus;
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
  const legalName = deal?.legal_name ?? null;

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
        legal_name: legalName,
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
  }, [dealId, deal?.name, displayName, nickname, borrowerName, legalName]);

  function handleCopyDealId() {
    if (!dealId) return;
    navigator.clipboard
      .writeText(dealId)
      .then(() => setCopyToast("Copied"))
      .catch(() => setCopyToast("Copy failed"))
      .finally(() => window.setTimeout(() => setCopyToast(null), 1200));
  }

  const base = `/deals/${dealId}`;

  const canonicalBadge = (() => {
    const st = canonicalMemoStatus?.status ?? "pending";
    if (st === "ready") return "bg-emerald-600/20 text-emerald-300 border-emerald-500/30";
    if (st === "partial") return "bg-amber-600/20 text-amber-200 border-amber-500/30";
    if (st === "error") return "bg-rose-600/20 text-rose-200 border-rose-500/30";
    return "bg-white/5 text-white/70 border-white/10";
  })();

  const tabs = [
    { label: "Overview", href: `/deals/${dealId}/underwrite` },
    { label: "Documents", href: `${base}/borrower-inbox` },
    { label: "Spreads", href: `${base}/spreads` },
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
        <div className="mx-auto max-w-[1600px] px-6 py-3">
          {/* Row 1: Back + Deal name + Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Back button + Deal name (always visible, takes priority) */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Link
                href="/deals"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/5 border border-white/10 shrink-0"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  arrow_back
                </span>
                <span className="hidden sm:inline">Deals</span>
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {borrowerName ? (
                    <span className="text-xs text-white/60 truncate max-w-[200px]">{borrowerName}</span>
                  ) : (
                    <span className="text-xs text-white/40 truncate">Borrower not set</span>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyDealId}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/10 shrink-0"
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
                    legalName={legalName}
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

            {/* Right: Key actions (responsive) */}
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/credit-memo/${dealId}/canonical`}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary/90"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  description
                </span>
                <span className="hidden sm:inline">Credit Memo</span>
              </Link>
              <ExportCanonicalMemoPdfButton
                dealId={dealId}
                className="hidden sm:inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
                label="PDF"
              />
            </div>
          </div>

          {/* Row 2: Financial metrics + status (hidden on small screens) */}
          <div className="hidden lg:flex items-center justify-between gap-4 mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-3">
              <FinancialSnapshotCapsule dealId={dealId} />
              <MatchedLendersCapsule dealId={dealId} />
            </div>

            <div className="flex items-center gap-2 text-xs text-white/70">
              <div className="flex flex-col items-end gap-0.5">
                <span
                  className={[
                    "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
                    canonicalBadge,
                  ].join(" ")}
                >
                  {canonicalMemoStatus?.status ?? "pending"}
                </span>
                <div className="text-[11px] text-white/50">
                  Last: {canonicalMemoStatus?.last_generated_at ?? "—"}
                </div>
              </div>
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
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-[1600px] px-6 pb-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <Tab
                key={t.href}
                href={t.href}
                label={t.label}
                active={(pathname ?? "") === t.href || (pathname ?? "").startsWith(t.href + "/")}
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
