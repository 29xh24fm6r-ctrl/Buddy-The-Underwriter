"use client";

import { useState } from "react";
import { SealPackageCard } from "@/components/brokerage/SealPackageCard";
import { SigningPanel } from "@/components/brokerage/SigningPanel";
import { ApprovalScoreCard } from "@/components/borrower/intake/ApprovalScoreCard";
import { IdentityVerificationPanel } from "@/components/borrower/intake/IdentityVerificationPanel";

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

// SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1 — maintainable blocker-to-section
// mapping. Every actionable blocker sbaAssumptionsValidator.ts (and its
// startup-specific rephrasing in sbaAssumptionsBootstrap.ts) can produce
// maps to the /start chapter that actually resolves it, so "Resolve in
// Financial Assumptions" is a real link, not a dead-end warning. Matched
// by keyword rather than exact string since rephraseBlockersForBorrower()
// varies the wording (e.g. the startup-specific revenue message).
const BLOCKER_CHAPTER_RULES: Array<{ match: RegExp; chapter: number; label: string }> = [
  { match: /revenue/i, chapter: 4, label: "Financial Assumptions → Revenue" },
  { match: /cogs|cost/i, chapter: 4, label: "Financial Assumptions → Costs" },
  { match: /loan amount|loan term|interest rate/i, chapter: 4, label: "Financial Assumptions → Loan Details" },
  { match: /management team|bio/i, chapter: 3, label: "Ownership & Management → Management Team" },
  { match: /owner/i, chapter: 3, label: "Ownership & Management → Ownership" },
];

function resolveBlockerChapter(blocker: string): { chapter: number; label: string } | null {
  for (const rule of BLOCKER_CHAPTER_RULES) {
    if (rule.match.test(blocker)) return { chapter: rule.chapter, label: rule.label };
  }
  return null;
}

function buildReviewItems(
  purposes: string[],
  verifications: DealVerificationState,
  assumptionsConfirmed: boolean,
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
      label: "Ownership & Identity",
      detail: verifications.identityVerified
        ? "Identity verified"
        : "Identity verification required",
      status: verifications.identityVerified ? "complete" : "flagged",
      source: "borrower_identity_verifications",
      resolveChapter: 3,
    },
    {
      key: "financial_assumptions",
      label: "Financial Assumptions",
      detail: assumptionsConfirmed
        ? "Confirmed"
        : "Revenue, costs, and loan details for your projections",
      status: assumptionsConfirmed ? "complete" : "pending",
      source: "buddy_sba_assumptions",
      resolveChapter: 4,
    },
    {
      key: "financials",
      label: "Supporting Documents",
      detail: verifications.financialsExtracted
        ? "Documents received"
        : "No documents uploaded yet",
      status: verifications.financialsExtracted ? "complete" : "pending",
      source: "deal_documents",
      resolveChapter: 5,
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
  scoreData,
}: {
  dealId: string;
  purposes: string[];
  verifications?: DealVerificationState;
  onNavigateChapter?: (chapter: number) => void;
  token?: string;
  scoreData?: {
    score: number;
    band: string;
    eligibilityPassed: boolean;
    eligibilityFailures?: Array<{ check: string; reason: string }>;
    topStrengths: string[];
    topWeaknesses: string[];
    narrative: string;
    computedAt: string | null;
  } | null;
}) {
  const [confirmState, setConfirmState] = useState<
    "idle" | "confirming" | "confirmed" | "blocked"
  >("idle");
  const [confirmBlockers, setConfirmBlockers] = useState<string[]>([]);
  const items = buildReviewItems(purposes, verifications, confirmState === "confirmed");

  const handleConfirmAssumptions = async () => {
    setConfirmState("confirming");
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm_assumptions" }),
        credentials: "include",
      });
      const json = await res.json();
      if (json.ok) {
        setConfirmState("confirmed");
      } else {
        setConfirmState("blocked");
        setConfirmBlockers(json.blockers ?? ["Unable to confirm at this time"]);
      }
    } catch {
      setConfirmState("blocked");
      setConfirmBlockers(["Network error — please try again"]);
    }
  };

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

      {/* Identity verification — T4 SPEC-BORROWER-FUNNEL-SEAL-BLOCKERS */}
      {token && !verifications.identityVerified && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Identity Verification</h3>
          <p className="mb-4 text-xs text-slate-500">
            SBA regulations require identity verification for every owner with 20% or more ownership. Complete verification below to unlock package sealing.
          </p>
          <IdentityVerificationPanel token={token} />
        </div>
      )}

      {/* Assumptions confirmation — T2 SPEC-BORROWER-FUNNEL-SEAL-BLOCKERS */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Confirm Your Numbers</h3>
        <p className="mb-4 text-xs text-slate-500">
          Lock in the financial assumptions Buddy will use to build your SBA package. You can still make changes after confirming.
        </p>
        {confirmState === "idle" && (
          <button
            type="button"
            onClick={handleConfirmAssumptions}
            className="rounded-lg bg-brand-blue-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-blue-600 transition-colors"
          >
            Confirm &amp; lock numbers
          </button>
        )}
        {confirmState === "confirming" && (
          <p className="text-sm text-slate-500">Confirming...</p>
        )}
        {confirmState === "confirmed" && (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-emerald-700">Numbers locked in</p>
          </div>
        )}
        {confirmState === "blocked" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-amber-700">A few things need attention first:</p>
            <ul className="space-y-2">
              {confirmBlockers.map((b, i) => {
                const resolved = resolveBlockerChapter(b);
                return (
                  <li key={i} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                    <span>&#x2022; {b}</span>
                    {resolved && onNavigateChapter && (
                      <button
                        type="button"
                        onClick={() => onNavigateChapter(resolved.chapter)}
                        className="shrink-0 whitespace-nowrap text-xs font-medium text-brand-blue-500 hover:text-brand-blue-400"
                      >
                        Resolve in {resolved.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={handleConfirmAssumptions}
              className="mt-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Certify + SealPackageCard */}
      <SealPackageCard dealId={dealId} />

      {/* Signing panel */}
      <SigningPanel dealId={dealId} />

      {/* Approval score */}
      {scoreData && <ApprovalScoreCard scoreData={scoreData} />}
      {!scoreData && token && <ApprovalScoreCard token={token} />}
    </div>
  );
}
