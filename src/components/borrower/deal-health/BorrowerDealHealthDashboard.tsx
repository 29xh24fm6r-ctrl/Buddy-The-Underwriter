"use client";

import { cn } from "@/lib/cn";
import type { BorrowerDealHealthViewModel } from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import { BorrowerDealHealthOverviewCards } from "./BorrowerDealHealthOverviewCards";
import { BorrowerDealHealthRadar } from "./BorrowerDealHealthRadar";
import { BorrowerUnderwriterPreviewCard } from "./BorrowerUnderwriterPreviewCard";
import { BorrowerFinancialSnapshot } from "./BorrowerFinancialSnapshot";
import { BorrowerAttentionItems } from "./BorrowerAttentionItems";

export function BorrowerDealHealthDashboard({
  viewModel,
}: {
  viewModel: BorrowerDealHealthViewModel;
}) {
  return (
    <div className="space-y-5">
      {/* Summary banner */}
      <div className="rounded-[1.25rem] border border-stone-200/70 bg-stone-50/50 px-5 py-3">
        <p className="text-sm leading-6 text-stone-700">
          {viewModel.summary}
        </p>
      </div>

      {/* Overview + Radar side by side on desktop */}
      <BorrowerDealHealthOverviewCards categories={viewModel.categories} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BorrowerDealHealthRadar categories={viewModel.categories} />
        <BorrowerFinancialSnapshot snapshot={viewModel.financialSnapshot} />
      </div>

      <BorrowerUnderwriterPreviewCard items={viewModel.reviewerPreview} />

      <BorrowerAttentionItems items={viewModel.attentionItems} />
    </div>
  );
}
