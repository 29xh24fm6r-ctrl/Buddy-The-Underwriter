"use client";

import { useMemo } from "react";
import { useSpreadOutput } from "@/hooks/useSpreadOutput";
import { usePricingInputs } from "@/hooks/usePricingInputs";
import { generateTreasuryProposals } from "@/lib/treasury/treasuryProposalEngine";
import { analyzeRelationshipPricing } from "@/lib/treasury/relationshipPricingEngine";
import type { TreasuryProposal } from "@/lib/treasury/treasuryProposalEngine";

// ─── Formatting ──────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "\u2014";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)
    return `${sign}$${Math.round(abs / 1_000).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function fmtBps(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return `${n} bps`;
}

// ─── Product labels ───────────────────────────────────────────────────────────

const PRODUCT_LABELS: Record<string, { name: string; icon: string }> = {
  LOCKBOX: { name: "Lockbox", icon: "\uD83D\uDCEC" },
  ACH_ORIGINATION: { name: "ACH Origination", icon: "\u26A1" },
  POSITIVE_PAY: { name: "Positive Pay", icon: "\uD83D\uDEE1" },
  SWEEP_ACCOUNT: { name: "Sweep Account", icon: "\uD83D\uDD04" },
  REMOTE_DEPOSIT_CAPTURE: { name: "Remote Deposit Capture", icon: "\uD83D\uDCF1" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-white/40 mb-3">
      {children}
    </div>
  );
}

function ValueCell({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "good" | "neutral" | null;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 flex flex-col gap-0.5 ${
        highlight === "good"
          ? "border-emerald-500/30 bg-emerald-950/20"
          : "border-white/10 bg-white/5"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-white/50">
        {label}
      </span>
      <span
        className={`font-semibold text-xl leading-tight ${
          highlight === "good" ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-white/40 mt-0.5">{sub}</span>}
    </div>
  );
}

function TreasuryCard({ proposal }: { proposal: TreasuryProposal }) {
  const meta = PRODUCT_LABELS[proposal.product] ?? {
    name: proposal.product,
    icon: "\u25C6",
  };

  return (
    <div
      className={`rounded-xl border px-5 py-4 space-y-2 ${
        proposal.recommended
          ? "border-emerald-500/25 bg-emerald-950/10"
          : "border-white/8 bg-white/[0.02]"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{meta.icon}</span>
          <span className="text-sm font-semibold text-white">{meta.name}</span>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${
            proposal.recommended
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-400"
              : "border-white/10 bg-white/5 text-white/30"
          }`}
        >
          {proposal.recommended ? "Recommended" : "Not applicable"}
        </span>
      </div>

      {/* Rationale */}
      <p className="text-xs text-white/70 leading-relaxed">
        {proposal.rationale}
      </p>

      {/* Borrower benefit + fee */}
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/[0.06]">
        <p className="text-xs text-white/50 italic flex-1">
          {proposal.borrowerBenefit}
        </p>
        {proposal.recommended && proposal.estimatedAnnualFee > 0 && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-white/30 uppercase tracking-wide">
              Est. annual fee
            </div>
            <div className="text-sm font-semibold text-white">
              {fmtDollars(proposal.estimatedAnnualFee)}
            </div>
          </div>
        )}
        {proposal.recommended && proposal.estimatedAnnualFee === 0 && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-white/30 uppercase tracking-wide">
              Revenue model
            </div>
            <div className="text-xs text-white/50">Spread-based</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RelationshipClient({ dealId }: { dealId: string }) {
  const { data: spread, loading: spreadLoading } = useSpreadOutput(dealId);
  const { data: pricingInputs, loading: pricingLoading } =
    usePricingInputs(dealId);

  const facts = spread?.canonical_facts ?? {};
  const years = (spread?.years_available ?? []).sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1] : null;

  // ── Extract inputs for engines ─────────────────────────────────────────────

  const grossReceipts = latestYear
    ? toNum(facts[`GROSS_RECEIPTS_${latestYear}`])
    : null;
  const accountsReceivable = latestYear
    ? (toNum(facts[`SL_AR_NET_${latestYear}`]) ??
      toNum(facts[`SL_AR_GROSS_${latestYear}`]))
    : null;
  const salariesWages = latestYear
    ? (toNum(facts[`SALARIES_WAGES_IS_${latestYear}`]) ??
      toNum(facts[`SALARIES_WAGES_${latestYear}`]))
    : null;
  const naicsCode =
    toNum(facts["NAICS_CODE"]) != null ? String(facts["NAICS_CODE"]) : null;

  const loanAmount =
    toNum(pricingInputs?.loan_amount) ?? toNum(facts["loan_amount"]);
  const spreadBps = pricingInputs?.spread_override_bps ?? null;

  // ── Run engines (pure, no side effects) ───────────────────────────────────

  const proposals = useMemo(
    () =>
      generateTreasuryProposals({
        avgDailyBalance: null,
        accountsReceivable,
        grossReceipts,
        salariesWages,
        depositVolatility: null,
        naicsCode,
      }),
    [accountsReceivable, grossReceipts, salariesWages, naicsCode],
  );

  const analysis = useMemo(
    () =>
      analyzeRelationshipPricing({
        loanAmount,
        loanSpreadBps: spreadBps,
        depositProfile: null,
        treasuryProposals: proposals,
      }),
    [loanAmount, spreadBps, proposals],
  );

  const recommendedCount = proposals.filter((p) => p.recommended).length;
  const totalTreasuryFees = proposals
    .filter((p) => p.recommended)
    .reduce((s, p) => s + p.estimatedAnnualFee, 0);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (spreadLoading || pricingLoading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-white/40">
        Loading relationship data\u2026
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-6 space-y-8">
      {/* ── Panel A: Relationship Value Summary ──────────────────────────── */}
      <div>
        <SectionHeader>Relationship Value &mdash; Annual Estimate</SectionHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ValueCell
            label="Total Wallet"
            value={fmtDollars(analysis.totalRelationshipValueAnnual)}
            sub="Loan + treasury"
            highlight={
              analysis.totalRelationshipValueAnnual != null ? "good" : null
            }
          />
          <ValueCell
            label="Treasury Fees"
            value={totalTreasuryFees > 0 ? fmtDollars(totalTreasuryFees) : "\u2014"}
            sub={`${recommendedCount} of 5 products`}
          />
          <ValueCell
            label="Spread Flexibility"
            value={fmtBps(analysis.impliedLoanSpreadAdjustmentBps || null)}
            sub="Deposit offset potential"
          />
          <ValueCell
            label="Deposit Relationship"
            value="Bank stmts needed"
            sub="Monthly balances required"
          />
        </div>

        {analysis.pricingNarrative && (
          <div className="mt-3 border-l-2 border-white/20 bg-white/[0.02] rounded-r-lg px-4 py-3">
            <p className="text-sm text-white/70 leading-relaxed">
              {analysis.pricingNarrative}
            </p>
          </div>
        )}
      </div>

      {/* ── Panel B: Treasury Product Proposals ──────────────────────────── */}
      <div>
        <SectionHeader>
          Treasury Products &mdash; {recommendedCount} Recommended
        </SectionHeader>

        {grossReceipts == null &&
        salariesWages == null &&
        accountsReceivable == null ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-6 text-sm text-white/40 text-center">
            Financial data required to generate treasury proposals. Extract
            documents and ensure IS / balance sheet facts are populated.
          </div>
        ) : (
          <div className="space-y-3">
            {proposals
              .sort(
                (a, b) =>
                  (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0),
              )
              .map((proposal) => (
                <TreasuryCard key={proposal.product} proposal={proposal} />
              ))}
          </div>
        )}
      </div>

      {/* ── Panel C: Deposit Profile ─────────────────────────────────────── */}
      <div>
        <SectionHeader>Deposit Profile</SectionHeader>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-6">
          <div className="flex items-start gap-4">
            <div className="text-3xl leading-none text-white/20">
              &#x1F3E6;
            </div>
            <div>
              <p className="text-sm font-medium text-white/60">
                Bank statement data required
              </p>
              <p className="text-xs text-white/40 mt-1 leading-relaxed">
                Monthly average daily balances are not available from tax return
                documents. Upload 12 months of bank statements and re-extract to
                generate: average daily balance, volatility score, seasonal
                pattern, low-balance stress periods, and earnings credit
                estimate.
              </p>
              <p className="text-xs text-white/40 mt-2">
                Without bank statements, deposit relationship value and sweep
                account recommendations are approximated only.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Panel D: Compliance Note ─────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-white/[0.015] px-5 py-4">
        <div className="text-[10px] uppercase tracking-wide text-white/30 mb-2">
          Regulatory Compliance
        </div>
        <p className="text-xs text-white/40 leading-relaxed">
          {analysis.complianceNote}
        </p>
        <p className="text-xs text-white/30 mt-2">
          Bank Holding Company Act Section 106 &middot; Regulation Y Safe Harbor
          &middot; OCC Guidance on Relationship Pricing
        </p>
      </div>
    </div>
  );
}
