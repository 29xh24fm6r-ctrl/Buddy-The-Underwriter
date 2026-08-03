"use client";

import { useEffect, useState } from "react";
import { SealPackageCard } from "@/components/brokerage/SealPackageCard";
import { SigningPanel } from "@/components/brokerage/SigningPanel";
import { ApprovalScoreCard } from "@/components/borrower/intake/ApprovalScoreCard";

type ReviewItem = {
  key: string;
  label: string;
  detail: string;
  status: "complete" | "pending" | "flagged";
  source: string;
  resolveChapter?: number;
};

export type DealVerificationState = {
  entityResolved?: boolean;
  identityVerified?: boolean;
  financialsExtracted?: boolean;
  franchiseMatched?: boolean;
};

function buildReviewItems(
  purposes: string[],
  verifications: DealVerificationState,
): ReviewItem[] {
  const isFranchise = purposes.includes("franchise");
  const items: ReviewItem[] = [
    {
      key: "financing",
      label: "Financing scope",
      detail: purposes.length > 0 ? "Use of funds defined and totaled" : "No purposes selected",
      status: purposes.length > 0 ? "complete" : "flagged",
      source: "purposes",
      resolveChapter: 1,
    },
    {
      key: "business",
      label: "Business verification",
      detail: verifications.entityResolved
        ? "Entity matched"
        : "Not started",
      status: verifications.entityResolved ? "complete" : "pending",
      source: "entity_resolution",
      resolveChapter: 2,
    },
    {
      key: "ownership",
      label: "Ownership",
      detail: verifications.identityVerified
        ? "Identity verified"
        : "Not started",
      status: verifications.identityVerified ? "complete" : "pending",
      source: "borrower_identity_verifications",
      resolveChapter: 3,
    },
    {
      key: "financials",
      label: "Financials",
      detail: verifications.financialsExtracted
        ? "Documents received"
        : "Not started",
      status: verifications.financialsExtracted ? "complete" : "pending",
      source: "deal_documents",
      resolveChapter: 4,
    },
  ];
  if (isFranchise) {
    items.push({
      key: "franchise",
      label: "Franchise Directory match",
      detail: verifications.franchiseMatched
        ? "Brand confirmed SBA-eligible"
        : "Not started",
      status: verifications.franchiseMatched ? "complete" : "pending",
      source: "franchise_directory_match",
    });
  }
  return items;
}

export function IntakeReviewStep({
  dealId,
  purposes,
  verifications = {},
  onNavigateChapter,
  token,
}: {
  dealId: string;
  purposes: string[];
  verifications?: DealVerificationState;
  onNavigateChapter?: (chapter: number) => void;
  token?: string;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);

  useEffect(() => {
    setItems(buildReviewItems(purposes, verifications));
  }, [purposes, verifications]);

  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            Here&apos;s everything in one place. Anything flagged needs a quick decision before I can send this out.
          </p>
        </div>
      </div>

      {/* Photo panel — pure CSS duotone scene */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A1F44] to-[#1a3a6a] px-6 py-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        {/* swap for licensed borrower photography in production */}
        <div className="relative z-10">
          <p className="text-sm font-medium text-white">Ready for review</p>
          <p className="mt-1 text-xs text-slate-300">
            Once sealed, your package is submitted for lender matching. We&apos;ll keep you posted on next steps.
          </p>
        </div>
      </div>

      {/* Review checklist */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-800">Package Readiness</h3>
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
            >
              {item.status === "complete" ? (
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : item.status === "flagged" ? (
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-400">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
              ) : (
                <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-200">
                  <div className="h-2 w-2 rounded-full bg-slate-400" />
                </div>
              )}
              <div className="flex-1">
                <p className={`text-sm ${item.status === "complete" ? "font-medium text-slate-800" : "text-slate-600"}`}>
                  {item.label}
                </p>
                <p className="text-xs text-slate-500">{item.detail}</p>
              </div>
              {item.status === "flagged" && item.resolveChapter && onNavigateChapter && (
                <button
                  type="button"
                  onClick={() => onNavigateChapter(item.resolveChapter!)}
                  className="text-xs font-medium text-brand-blue-500 hover:text-brand-blue-400"
                >
                  Resolve now
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Certify + SealPackageCard */}
      <SealPackageCard dealId={dealId} />

      {/* Signing panel */}
      <SigningPanel dealId={dealId} />

      {/* Approval score */}
      {token && <ApprovalScoreCard token={token} />}
    </div>
  );
}
