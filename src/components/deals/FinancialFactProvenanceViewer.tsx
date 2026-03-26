"use client";

/**
 * Phase 55B — Provenance Viewer
 *
 * Shows where a financial fact came from and whether it's been confirmed.
 */

type ProvenanceSource = {
  documentId: string | null;
  extractedField: string | null;
  spreadLineRef: string | null;
  manualAdjustmentSource: string | null;
  confidence: number | null;
};

type Props = {
  provenance: ProvenanceSource[];
  primaryDocumentId: string | null;
  validationState: string;
  reviewerRationale: string | null;
};

export function FinancialFactProvenanceViewer({ provenance, primaryDocumentId, validationState, reviewerRationale }: Props) {
  if (provenance.length === 0) {
    return <div className="text-xs text-gray-400 italic">No provenance data available</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Provenance Sources</div>
      {provenance.map((p, i) => {
        const isPrimary = p.documentId === primaryDocumentId;
        return (
          <div key={i} className={`text-xs border rounded p-2 ${isPrimary ? "border-blue-300 bg-blue-50" : "border-gray-200"}`}>
            <div className="flex items-center gap-2">
              {isPrimary && <span className="text-[10px] font-bold text-blue-600">PRIMARY</span>}
              {p.documentId && <span className="font-mono text-gray-500">Doc: {p.documentId.slice(0, 8)}...</span>}
            </div>
            {p.extractedField && <div className="text-gray-500 mt-0.5">Field: {p.extractedField}</div>}
            {p.spreadLineRef && <div className="text-gray-500 mt-0.5">Spread: {p.spreadLineRef}</div>}
            {p.manualAdjustmentSource && <div className="text-purple-600 mt-0.5">Adjustment: {p.manualAdjustmentSource}</div>}
            {p.confidence != null && (
              <div className="mt-0.5">
                Confidence: <span className={p.confidence >= 0.9 ? "text-emerald-600" : p.confidence >= 0.7 ? "text-amber-600" : "text-red-600"}>
                  {Math.round(p.confidence * 100)}%
                </span>
              </div>
            )}
          </div>
        );
      })}
      {reviewerRationale && (
        <div className="border-t pt-2 mt-2">
          <div className="text-[10px] font-semibold text-gray-500 uppercase">Reviewer Note</div>
          <div className="text-xs text-gray-700 mt-0.5">{reviewerRationale}</div>
        </div>
      )}
    </div>
  );
}
