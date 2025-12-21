"use client";

import { useEffect, useState } from "react";
import { useDealRealtimeRefresh } from "@/hooks/useDealRealtimeRefresh";
import { EvidenceChips } from "@/components/evidence/EvidenceChips";

type DocIntelRow = {
  id: string;
  file_id: string;
  doc_type: string;
  tax_year: string | null;
  extracted_json: any;
  quality_json: any;
  confidence: number | null; // 0..100
  evidence_json: any;
  created_at: string;
};

export default function DocumentInsightsCard({ dealId }: { dealId: string }) {
  const { refreshKey } = useDealRealtimeRefresh(dealId);

  const [results, setResults] = useState<DocIntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) return;

    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/deals/${dealId}/doc-intel/results`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || "doc_intel_load_failed");
        if (alive) setResults(j.results || []);
      } catch (e: any) {
        if (alive) setErr(e?.message || "doc_intel_load_failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [dealId, refreshKey]);

  const latest = results.slice(0, 5);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm mb-1">Document Insights</h3>
          <p className="text-xs text-gray-600">AI classification, extraction, and quality checks</p>
        </div>

        <EvidenceChips
          dealId={dealId}
          scope="doc_intel"
          action="classify_extract_quality"
          label="Why these classifications?"
          limit={10}
        />
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      ) : err ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {err}
        </div>
      ) : latest.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 mb-2">No document intelligence yet</p>
          <p className="text-xs text-gray-400">Upload documents and run OCR/doc intel to see insights</p>
        </div>
      ) : (
        <div className="space-y-3">
          {latest.map((row) => (
            <div key={row.id} className="p-3 rounded border border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-xs font-medium text-gray-800">
                  {row.doc_type || "Unknown"}{" "}
                  {row.tax_year ? <span className="text-gray-500">• {row.tax_year}</span> : null}
                </div>

                <div className="text-xs text-gray-600">
                  {typeof row.confidence === "number" ? `${Math.round(row.confidence)}% confidence` : "—"}
                </div>
              </div>

              {row.quality_json ? (
                <div className="text-[11px] text-gray-600">
                  Quality:{" "}
                  <span className="font-medium">
                    {row.quality_json.legible === false ? "Not legible" : "Legible"}
                  </span>
                  {" • "}
                  <span className="font-medium">
                    {row.quality_json.complete === false ? "Incomplete" : "Complete"}
                  </span>
                  {row.quality_json.signed === null ? null : (
                    <>
                      {" • "}
                      <span className="font-medium">
                        {row.quality_json.signed ? "Signed" : "Unsigned"}
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              {row.extracted_json && Object.keys(row.extracted_json || {}).length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-gray-700">
                    View extracted fields
                  </summary>
                  <pre className="mt-2 overflow-auto rounded-md bg-white p-2 text-[11px] text-gray-800">
{JSON.stringify(row.extracted_json, null, 2)}
                  </pre>
                </details>
              ) : (
                <div className="mt-2 text-xs text-gray-500 italic">
                  No structured fields extracted yet.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
