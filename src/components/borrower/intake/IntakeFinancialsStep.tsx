"use client";

import { PlaidConnectCard } from "@/components/borrower/PlaidConnectCard";

export function IntakeFinancialsStep({
  dealId,
  isFranchise,
  onContinue,
}: {
  dealId: string;
  isFranchise: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            No need to dig up PDFs — connect these and I&apos;ll pull what lenders need automatically. No credit pull, ever.
          </p>
        </div>
      </div>

      {/* Plaid bank connect */}
      <div className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <PlaidConnectCard dealId={dealId} />
      </div>

      {/* IRS Tax Transcripts */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-900">Tax Transcripts</h3>
            <p className="mt-1 text-xs text-slate-500">
              Pulled directly from the IRS via Form 4506-C. No PDFs needed.
            </p>
          </div>
          <span className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-400">
            Coming soon
          </span>
        </div>
      </div>

      {/* Franchise-specific: FDD upload */}
      {isFranchise && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <svg className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-900">Franchise Agreement & FDD</h3>
              <p className="mt-1 text-xs text-amber-700">
                Item 7 and Item 19 help us pre-check your unit economics. Upload when you have it — not a blocker.
              </p>
            </div>
            <span className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-600">
              Coming soon
            </span>
          </div>
        </div>
      )}

      {/* Async note */}
      <div className="rounded-xl bg-slate-50 px-5 py-4">
        <p className="text-xs text-slate-500">
          Retrieval and document verification continue after you finish — you&apos;ll get a notification, not a wait screen.
        </p>
      </div>

      {/* Continue */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onContinue}
          className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
