"use client";

import { useState, useEffect } from "react";

type WizardProps = {
  dealId: string;
  principals: Array<{ id: string; name: string }>;
  missingMetrics: string[];
};

type Overrides = {
  business_description?: string;
  revenue_mix?: string;
  seasonality?: string;
  collateral_description?: string;
  [key: string]: string | undefined;
};

// Explicit text-gray-900 + bg-white required — app CSS context otherwise
// renders typed text invisible (white on white).
const inputCls =
  "w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400";
const textareaCls = inputCls + " resize-none";

export default function MemoCompletionWizard({ dealId, principals, missingMetrics }: WizardProps) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docGapsOpen, setDocGapsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/deals/${dealId}/credit-memo/overrides`)
      .then(r => r.json())
      .then(d => { if (d.ok) setOverrides(d.overrides ?? {}); })
      .catch(() => {});
  }, [open, dealId]);

  const set = (key: string, val: string) =>
    setOverrides(prev => ({ ...prev, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-memo/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => {
          setOpen(false);
          window.location.reload();
        }, 800);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
      >
        <span className="material-symbols-outlined text-[14px]">edit_note</span>
        Complete Missing Fields
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col"
            style={{ maxHeight: "calc(100vh - 2rem)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 flex-shrink-0">
              <div>
                <div className="text-sm font-bold text-gray-900">Complete Credit Memo</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Fill in qualitative fields — these can&apos;t be extracted from documents
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-4 text-gray-400 hover:text-gray-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-6 py-5 flex-1 space-y-5">

              {/* Document gaps — collapsible so they don't eat the viewport */}
              {missingMetrics.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50">
                  <button
                    onClick={() => setDocGapsOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-amber-800 uppercase tracking-wide"
                  >
                    <span>
                      ⚠ {missingMetrics.length} field{missingMetrics.length !== 1 ? "s" : ""} require document uploads
                    </span>
                    <span className="text-amber-500 ml-2">{docGapsOpen ? "▲" : "▼"}</span>
                  </button>
                  {docGapsOpen && (
                    <div className="px-4 pb-3 pt-2 border-t border-amber-200 text-xs text-amber-700 space-y-1">
                      {missingMetrics.map(m => (
                        <div key={m} className="flex items-start gap-2">
                          <span className="text-amber-400 mt-0.5 flex-shrink-0">→</span>
                          <span>
                            <span className="font-medium">{m}:</span> Upload the required source document and re-run spreads
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Business Profile ─────────────────────────────── */}
              <div>
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Business Profile
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Business Operations &amp; History
                    </label>
                    <p className="text-xs text-gray-400 mb-1.5">
                      Who is the borrower, what do they do, how long have they been operating?
                    </p>
                    <textarea
                      rows={4}
                      value={overrides.business_description ?? ""}
                      onChange={e => set("business_description", e.target.value)}
                      placeholder="e.g. Samaritus Management LLC operates Yacht Hampton, a luxury boat charter and rental business founded in 2017 in Sag Harbor, NY. The company operates a modern fleet of 25–30 vessels including electric yachts, serving affluent leisure and corporate event customers in the Hamptons market..."
                      className={textareaCls}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Revenue Mix
                      </label>
                      <p className="text-xs text-gray-400 mb-1.5">Breakdown of revenue streams</p>
                      <textarea
                        rows={2}
                        value={overrides.revenue_mix ?? ""}
                        onChange={e => set("revenue_mix", e.target.value)}
                        placeholder="e.g. 60% boat rentals, 30% corporate events, 10% lessons"
                        className={textareaCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Seasonality
                      </label>
                      <p className="text-xs text-gray-400 mb-1.5">Peak and off-peak periods</p>
                      <textarea
                        rows={2}
                        value={overrides.seasonality ?? ""}
                        onChange={e => set("seasonality", e.target.value)}
                        placeholder="e.g. Peak May–Sep (85% of revenue), minimal Oct–Apr"
                        className={textareaCls}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Collateral Description ────────────────────────── */}
              <div>
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                  Collateral Description
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Describe the collateral in plain language (assets, condition, location)
                </p>
                <textarea
                  rows={3}
                  value={overrides.collateral_description ?? ""}
                  onChange={e => set("collateral_description", e.target.value)}
                  placeholder="e.g. Modern marine vessel fleet including 2023 Aquila 36 catamaran, 640 Galeon motor yacht, and Lilybaeum 27 electric vessel. Fleet maintained at Sag Harbor Marina."
                  className={textareaCls}
                />
              </div>

              {/* ── Management Qualifications ─────────────────────── */}
              {principals.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                    Management Qualifications
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    Career background, industry experience, track record for each principal
                  </p>
                  <div className="space-y-4">
                    {principals.map(p => (
                      <div key={p.id}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          {p.name}
                        </label>
                        <textarea
                          rows={3}
                          value={overrides[`principal_bio_${p.id}`] ?? ""}
                          onChange={e => set(`principal_bio_${p.id}`, e.target.value)}
                          placeholder={`Career background, industry experience, other ventures, and track record for ${p.name}...`}
                          className={textareaCls}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 flex-shrink-0">
              <div className="text-xs text-gray-400">Changes reload the memo automatically</div>
              <div className="flex gap-3">
                <button
                  onClick={() => setOpen(false)}
                  className="text-xs text-gray-600 hover:text-gray-900 px-3 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || saved}
                  className={`text-xs font-semibold px-4 py-2 rounded-md transition-colors ${
                    saved
                      ? "bg-emerald-600 text-white"
                      : saving
                        ? "bg-gray-400 text-white cursor-wait"
                        : "bg-gray-900 text-white hover:bg-gray-700"
                  }`}
                >
                  {saved ? "Saved ✓" : saving ? "Saving..." : "Save & Refresh"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
