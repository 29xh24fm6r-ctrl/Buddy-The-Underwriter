"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { BorrowerJourneyViewModel } from "@/lib/borrower/buildBorrowerJourneyViewModel";
import type { BorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import type { BorrowerDealHealthViewModel } from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import { BorrowerBlockersCard } from "./BorrowerBlockersCard";
import { BorrowerJourneyActionCard } from "./BorrowerJourneyActionCard";
import { BorrowerJourneyMilestones } from "./BorrowerJourneyMilestones";
import { BorrowerProgressSummary } from "./BorrowerProgressSummary";
import { BorrowerReadinessHero } from "./readiness/BorrowerReadinessHero";
import { BorrowerDealInsightsCard } from "./readiness/BorrowerDealInsightsCard";
import { BorrowerRecommendationsCard } from "./readiness/BorrowerRecommendationsCard";
import { BorrowerActivityFeed } from "./readiness/BorrowerActivityFeed";
import { BorrowerDocumentCompletionChart } from "./readiness/BorrowerDocumentCompletionChart";
import { BorrowerDealHealthDashboard } from "./deal-health/BorrowerDealHealthDashboard";
import { BorrowerGuidancePanel } from "./guidance/BorrowerGuidancePanel";

function JourneyHeader({
  dealName,
  progressPercent,
  statusSummary,
}: {
  dealName?: string | null;
  progressPercent: number;
  statusSummary: string;
}) {
  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-amber-200/70 bg-[linear-gradient(135deg,_rgba(251,191,36,0.10)_0%,_rgba(15,118,110,0.06)_100%)] p-5 sm:p-7">
      <div className="space-y-4">
        {dealName && (
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            {dealName}
          </div>
        )}

        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h2 className="font-serif text-2xl leading-tight text-stone-950 sm:text-3xl">
              Your SBA funding package is{" "}
              <span className="text-amber-800">{progressPercent}%</span>{" "}
              complete.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
              {statusSummary}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-5 py-3 shadow-sm">
            <div className="relative h-14 w-14">
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="#e7e5e4"
                  strokeWidth="3"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="url(#journey-gradient)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(progressPercent / 100) * 100.5} 100.5`}
                />
                <defs>
                  <linearGradient
                    id="journey-gradient"
                    x1="0"
                    y1="0"
                    x2="36"
                    y2="36"
                  >
                    <stop offset="0%" stopColor="#b45309" />
                    <stop offset="100%" stopColor="#0f766e" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-stone-900">
                  {progressPercent}%
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
                Progress
              </div>
              <div className="mt-0.5 text-sm font-semibold text-stone-900">
                {progressPercent < 30
                  ? "Getting started"
                  : progressPercent < 60
                    ? "Building your file"
                    : progressPercent < 85
                      ? "Strong progress"
                      : "Almost there"}
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div
          className="h-2.5 overflow-hidden rounded-full bg-stone-200/60"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,_#b45309_0%,_#0f766e_100%)] transition-all duration-700"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </section>
  );
}

export function BorrowerFundingJourney({
  viewModel,
  readinessViewModel,
  dealHealthViewModel,
  guidanceViewModel,
  dealName,
}: {
  viewModel: BorrowerJourneyViewModel;
  readinessViewModel?: BorrowerReadinessViewModel;
  dealHealthViewModel?: BorrowerDealHealthViewModel;
  guidanceViewModel?: BorrowerGuidanceViewModel;
  dealName?: string | null;
}) {
  return (
    <div className="space-y-5">
      <JourneyHeader
        dealName={dealName}
        progressPercent={viewModel.progressPercent}
        statusSummary={viewModel.statusSummary}
      />

      {/* Readiness Intelligence Layer (Spec 2) */}
      {readinessViewModel && (
        <>
          <BorrowerReadinessHero
            readiness={readinessViewModel.readiness}
            dealName={dealName}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <BorrowerDealInsightsCard insights={readinessViewModel.insights} />
            <BorrowerDocumentCompletionChart
              received={readinessViewModel.documentStats.received}
              underReview={readinessViewModel.documentStats.underReview}
              remaining={readinessViewModel.documentStats.remaining}
              completionPercent={readinessViewModel.documentCompletionPercent}
            />
          </div>

          <BorrowerRecommendationsCard
            recommendations={readinessViewModel.recommendations}
          />
        </>
      )}

      {/* Guidance Engine (Spec 4) */}
      {guidanceViewModel && (
        <BorrowerGuidancePanel viewModel={guidanceViewModel} />
      )}

      {/* Deal Health Dashboard (Spec 3) */}
      {dealHealthViewModel && (
        <BorrowerDealHealthDashboard viewModel={dealHealthViewModel} />
      )}

      <BorrowerJourneyMilestones milestones={viewModel.milestones} />

      <BorrowerJourneyActionCard action={viewModel.nextBestAction} />

      <BorrowerProgressSummary
        completedItems={viewModel.completedItems}
        remainingItems={viewModel.remainingItems}
      />

      <BorrowerBlockersCard blockers={viewModel.blockers} />

      {/* Activity Feed (Spec 2) */}
      {readinessViewModel && readinessViewModel.activity.length > 0 && (
        <BorrowerActivityFeed events={readinessViewModel.activity} />
      )}
    </div>
  );
}
