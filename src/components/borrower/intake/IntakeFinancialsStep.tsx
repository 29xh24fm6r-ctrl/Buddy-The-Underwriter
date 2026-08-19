"use client";

import { useCallback, useState } from "react";
import { PlaidConnectCard } from "@/components/borrower/PlaidConnectCard";
import { PortalUploadDropzone } from "@/components/borrower/intake/PortalUploadDropzone";

export function IntakeFinancialsStep({
  dealId,
  isFranchise,
  onContinue,
  onDocumentUploaded,
}: {
  dealId: string;
  isFranchise: boolean;
  onContinue: (data?: Record<string, unknown>) => void;
  /**
   * Fired after a document is successfully recorded so the parent can
   * refresh journey/readiness state. Without this the borrower uploads a
   * document and the Review screen still reports "No documents uploaded
   * yet" until they start over.
   */
  onDocumentUploaded?: () => void;
}) {
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [monthlyRevenue, setMonthlyRevenue] = useState("");
  const [revenueMode, setRevenueMode] = useState<"annual" | "monthly">("annual");
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  /**
   * LAUNCH FIX — borrower document uploads.
   *
   * This step previously called `directDealDocumentUpload`, which posts to
   * `/api/deals/[dealId]/files/sign` and `/record`. Those are the
   * CLERK-AUTHED banker routes: a self-serve borrower holding only a
   * `buddy_borrower_session` cookie is rejected there.
   *
   * The failure was silent. `directDealDocumentUpload` RETURNS an error
   * object rather than throwing, so the surrounding try/catch never fired,
   * `count` stayed 0, and the borrower saw no error and no confirmation —
   * the button simply appeared to do nothing.
   *
   * `PortalUploadDropzone` uses `uploadBorrowerFile`, which posts to the
   * token-authed `/api/portal/[token]/files/*` routes and records the row
   * with source "borrower". `resolvePortalContext` accepts the dealId as
   * the token when it matches the authenticated borrower session, so the
   * same signed-URL architecture and every upload guard (MIME allowlist,
   * 50MB cap, upload sessions, ledger events) are preserved unchanged.
   *
   * No second upload implementation is introduced: this deletes a
   * misrouted call and reuses the existing borrower component.
   */
  const handleUploadComplete = useCallback(() => {
    setUploadedCount((prev) => prev + 1);
    onDocumentUploaded?.();
  }, [onDocumentUploaded]);

  const computedAnnual =
    revenueMode === "annual"
      ? Number(annualRevenue) || 0
      : (Number(monthlyRevenue) || 0) * 12;

  const handleContinue = async () => {
    setSaving(true);
    try {
      if (computedAnnual > 0) {
        await fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            factPath: "business.annual_revenue",
            value: String(computedAnnual),
          }),
          credentials: "include",
        });
      }
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
    onContinue({ annualRevenue: computedAnnual, plaidConnected, documentsUploaded: uploadedCount > 0 });
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
            Let me know your revenue so I can build your projections. You can also connect your bank account to speed things up.
          </p>
        </div>
      </div>

      {/* Revenue input */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-900">Business Revenue</h3>
            <p className="mt-1 text-xs text-slate-500">
              Approximate is fine — lenders will verify from your bank statements and tax returns later.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setRevenueMode("annual")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                revenueMode === "annual"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Annual
            </button>
            <button
              type="button"
              onClick={() => setRevenueMode("monthly")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                revenueMode === "monthly"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Monthly
            </button>
          </div>

          {revenueMode === "annual" ? (
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={annualRevenue}
                onChange={(e) => setAnnualRevenue(e.target.value)}
                placeholder="e.g. 500000"
                className="w-full rounded-xl border border-slate-300 py-3 pl-8 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">per year</span>
            </div>
          ) : (
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                type="number"
                min={0}
                step={100}
                value={monthlyRevenue}
                onChange={(e) => setMonthlyRevenue(e.target.value)}
                placeholder="e.g. 40000"
                className="w-full rounded-xl border border-slate-300 py-3 pl-8 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">per month</span>
            </div>
          )}

          {computedAnnual > 0 && revenueMode === "monthly" && (
            <p className="text-xs text-slate-500 px-1">
              = ${computedAnnual.toLocaleString()} per year
            </p>
          )}
        </div>
      </div>

      {/* Plaid bank connect */}
      <div className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <PlaidConnectCard dealId={dealId} onConnected={() => setPlaidConnected(true)} />
      </div>

      {plaidConnected && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-xl border border-emerald-100 bg-emerald-50/50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">Bank account connected.</p>
          <p className="mt-1 text-xs text-emerald-700">
            We&apos;ll pull statements automatically — no PDFs to upload.
          </p>
        </div>
      )}

      {/* Document upload */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-900">Upload Documents</h3>
            <p className="mt-1 text-xs text-slate-500">
              Bank statements, tax returns, or any supporting documents you have ready.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <PortalUploadDropzone
            token={dealId}
            dealId={dealId}
            onUploadComplete={handleUploadComplete}
          />
          {uploadedCount > 0 && (
            <p className="mt-3 text-xs text-emerald-600">
              {uploadedCount} document{uploadedCount !== 1 ? "s" : ""} uploaded to your package
            </p>
          )}
        </div>
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
          onClick={handleContinue}
          disabled={saving}
          className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}
