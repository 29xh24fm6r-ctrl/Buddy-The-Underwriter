"use client";

import { useState, useEffect } from "react";
import { MemoQualitativeForm } from "./MemoQualitativeForm";
import type { QualitativeOverrides } from "./MemoQualitativeForm";

type WizardProps = {
  dealId: string;
  principals: Array<{ id: string; name: string }>;
  missingMetrics: string[];
};

type Overrides = QualitativeOverrides;

export default function MemoCompletionWizard({ dealId, principals, missingMetrics }: WizardProps) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docGapsOpen, setDocGapsOpen] = useState(false);

  // Always show at least one management bio entry.
  // If no owner entities exist in DB, show a generic "Management Team" field.
  const mgmtEntries =
    principals.length > 0
      ? principals
      : [{ id: "general", name: "Management Team" }];

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

              {/* Document gaps — collapsible */}
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

              <MemoQualitativeForm
                overrides={overrides}
                onChange={set}
                principals={mgmtEntries}
                theme="light"
              />
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
