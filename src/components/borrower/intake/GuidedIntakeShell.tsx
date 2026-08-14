"use client";

import { type ReactNode } from "react";
import {
  BrokerageStageStrip,
  deriveBrokerageStage,
  type JourneyStatusInput,
} from "@/components/brokerage/BrokerageStageStrip";
import type { FieldProgress } from "@/lib/sba/forms/borrowerFieldProgress";

const CHAPTER_LABELS = [
  "Financing",
  "Business",
  "Ownership & Management",
  "Financial Assumptions",
  "Documents",
  "Review",
] as const;

export function GuidedIntakeShell({
  currentChapter,
  dealId,
  onChapterChange,
  totalAmount,
  journeyStatus,
  fieldProgress,
  nextStepsSummary,
  children,
}: {
  currentChapter: 1 | 2 | 3 | 4 | 5 | 6;
  dealId: string;
  onChapterChange: (n: number) => void;
  totalAmount: number;
  journeyStatus: JourneyStatusInput;
  fieldProgress?: FieldProgress | null;
  nextStepsSummary?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-40 -mx-4 bg-white/95 px-4 pb-3 pt-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mb-3">
          <BrokerageStageStrip
            activeStage={deriveBrokerageStage({
              hasDealId: true,
              progressPct: fieldProgress?.determinable && fieldProgress.requiredTotal > 0
                ? Math.round((fieldProgress.completedCount / fieldProgress.requiredTotal) * 100)
                : 0,
              sealed: journeyStatus.sealed,
              listed: journeyStatus.listingStatus === "claiming",
              claimWindowClosed:
                journeyStatus.listingStatus === "awaiting_borrower_pick" ||
                journeyStatus.listingStatus === "picked",
            })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">
              Chapter {currentChapter}: {CHAPTER_LABELS[currentChapter - 1]}
            </span>
            {fieldProgress?.determinable && (() => {
              const ch = fieldProgress.byChapter[currentChapter as 1 | 2 | 3 | 4 | 5 | 6];
              return ch.total > 0 ? (
                <span className="text-xs text-slate-500">
                  {ch.complete} of {ch.total} done
                </span>
              ) : null;
            })()}
          </div>
          {currentChapter === 1 && !fieldProgress?.determinable && (
            <span className="text-xs text-slate-500">Most people finish in about 30 minutes</span>
          )}
        </div>
        {nextStepsSummary && (
          <p className="mt-1 text-xs text-slate-500">{nextStepsSummary}</p>
        )}

        {/* Momentum rail */}
        <div className="mt-3 flex gap-1.5">
          {CHAPTER_LABELS.map((label, i) => {
            const chapterNum = i + 1;
            const isCompleted = chapterNum < currentChapter;
            const isActive = chapterNum === currentChapter;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (chapterNum <= currentChapter) onChapterChange(chapterNum);
                }}
                disabled={chapterNum > currentChapter}
                className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                  isCompleted
                    ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                    : isActive
                      ? "bg-gradient-to-r from-[#1c8de0] to-[#4db8f0]"
                      : "bg-slate-200"
                } ${chapterNum <= currentChapter ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                aria-label={`${label} — ${isCompleted ? "completed" : isActive ? "current" : "upcoming"}`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {CHAPTER_LABELS.map((label, i) => (
            <span
              key={label}
              className={`flex-1 text-center text-[10px] ${
                i + 1 <= currentChapter ? "font-medium text-slate-600" : "text-slate-400"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Active chapter content */}
      <div className="min-h-[400px]">{children}</div>

      {/* Sticky bottom summary bar */}
      {totalAmount > 0 && (
        <div className="sticky bottom-0 z-40 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500">Total financing</span>
              <p className="text-lg font-bold text-slate-900">
                ${totalAmount.toLocaleString()}
              </p>
            </div>
            {currentChapter < 6 && (
              <button
                type="button"
                onClick={() => onChapterChange(currentChapter + 1)}
                className="brand-gradient-cta rounded-2xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
