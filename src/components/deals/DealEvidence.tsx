"use client";

type Document = {
  id: string;
  display_name: string;
  checklist_key?: string | null;
  matched?: boolean;
};

type DealEvidenceProps = {
  docs: Document[];
};

/**
 * DealEvidence - Received documents as affirmations
 * 
 * Documents should feel like EVIDENCE, not file uploads.
 * Shows "the system understood it" not "you uploaded a file".
 * 
 * Psychological shift:
 * - Before: "Did I upload the right thing?"
 * - After: "The system understood it."
 * 
 * Creates visceral confidence.
 */
export function DealEvidence({ docs }: DealEvidenceProps) {
  if (!docs || docs.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        Received & verified
      </div>
      <div className="space-y-2">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between rounded-lg bg-slate-900/80 border border-slate-800 px-4 py-3 text-sm transition-colors hover:bg-slate-900"
          >
            <span className="text-slate-200">{doc.display_name}</span>
            <span className="text-xs font-medium text-emerald-400">
              {doc.matched || doc.checklist_key ? "Matched" : "Received"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
