"use client";

import Link from "next/link";
import { MilestoneChip } from "./MilestoneChip";
import { FixWithBuddyButton } from "@/components/deals/FixWithBuddyButton";
import type { BuilderReadiness, LoanType } from "@/lib/builder/builderTypes";

type Props = {
  dealId: string;
  dealName: string;
  loanType: LoanType | null;
  requestedAmount: number | null;
  stage: string | null;
  readiness: BuilderReadiness;
};

function fmtAmount(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  sba_7a: "SBA 7(a)",
  sba_504: "SBA 504",
  usda_b_and_i: "USDA B&I",
  cre_mortgage: "CRE Mortgage",
  ci_loan: "C&I Loan",
  equipment: "Equipment",
  construction: "Construction",
  other: "Other",
};

export function BuilderHeader({
  dealId,
  dealName,
  loanType,
  requestedAmount,
  stage,
  readiness,
}: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm px-5 py-3 space-y-3">
      {/* Row 1 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white truncate max-w-[300px]">
            {dealName || "Untitled Deal"}
          </h1>
          {loanType && (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70">
              {LOAN_TYPE_LABELS[loanType] ?? loanType}
            </span>
          )}
          {requestedAmount != null && requestedAmount > 0 && (
            <span className="text-sm font-semibold text-white/80">
              {fmtAmount(requestedAmount)}
            </span>
          )}
          {stage && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60 capitalize">
              {stage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MilestoneChip label="Credit Ready" active={readiness.credit_ready} />
          <MilestoneChip label="Doc Ready" active={readiness.doc_ready} />
        </div>
      </div>

      {/* Row 2: Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/deals/${dealId}/risk`}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Run Analysis
        </Link>
        <FixWithBuddyButton dealId={dealId} />
        <Link
          href={`/credit-memo/${dealId}/canonical`}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
        >
          View Credit Memo
        </Link>
        <button
          type="button"
          disabled={!readiness.credit_ready}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit to Credit
        </button>
        {/* Generate Docs: hidden until document generation backend is ready */}
      </div>
    </div>
  );
}
