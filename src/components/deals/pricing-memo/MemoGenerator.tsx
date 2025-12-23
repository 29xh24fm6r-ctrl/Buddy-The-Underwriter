"use client";

import { useState } from "react";

type GeneratedDocument = {
  id: string;
  title: string;
  content_json: any;
  status: string;
  created_at: string;
  pdf_storage_path?: string | null;
};

export function MemoGenerator({
  dealId,
  snapshotId,
  riskFactsId,
  pricingQuoteId,
  documents,
  onGenerated,
}: {
  dealId: string;
  snapshotId: string | null;
  riskFactsId: string | null;
  pricingQuoteId: string | null;
  documents: GeneratedDocument[];
  onGenerated: (doc: GeneratedDocument) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDocument | null>(
    documents.length > 0 ? documents[0] : null
  );
  const [viewMode, setViewMode] = useState<"outline" | "json">("outline");

  const handleGenerateMemo = async () => {
    if (!snapshotId || !riskFactsId) {
      alert("Please generate risk facts first");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/memos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId,
          riskFactsId,
          pricingQuoteId,
        }),
      });

      if (!res.ok) throw new Error("Failed to generate memo");

      const data = await res.json();
      onGenerated(data.generated_document);
      setSelectedDoc(data.generated_document);
    } catch (error) {
      console.error("Error generating memo:", error);
      alert("Failed to generate memo");
    } finally {
      setLoading(false);
    }
  };

  const handleRenderPdf = async () => {
    if (!selectedDoc) return;

    setRenderingPdf(true);
    try {
      // Generate PDF
      const res = await fetch(
        `/api/deals/${dealId}/memos/${selectedDoc.id}/render-pdf`,
        { method: "POST" }
      );

      if (!res.ok) throw new Error("Failed to render PDF");

      const data = await res.json();
      
      // Get signed URL
      const urlRes = await fetch(
        `/api/deals/${dealId}/memos/${selectedDoc.id}/signed-url`
      );

      if (!urlRes.ok) throw new Error("Failed to get PDF URL");

      const { url } = await urlRes.json();
      
      // Open PDF in new tab
      window.open(url, "_blank", "noopener,noreferrer");
      
      // Update document in list
      onGenerated(data.generated_document);
      setSelectedDoc(data.generated_document);
    } catch (error) {
      console.error("Error rendering PDF:", error);
      alert("Failed to render PDF");
    } finally {
      setRenderingPdf(false);
    }
  };

  const handleViewPdf = async () => {
    if (!selectedDoc) return;

    try {
      const urlRes = await fetch(
        `/api/deals/${dealId}/memos/${selectedDoc.id}/signed-url`
      );

      if (!urlRes.ok) throw new Error("Failed to get PDF URL");

      const { url } = await urlRes.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Error viewing PDF:", error);
      alert("Failed to view PDF");
    }
  };

  const handlePreview = () => {
    if (!selectedDoc) return;
    window.open(
      `/deals/${dealId}/memos/${selectedDoc.id}/preview`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Memo Generator</h3>
        <div className="flex gap-2">
          <button
            onClick={handleGenerateMemo}
            disabled={loading || !riskFactsId}
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Memo JSON"}
          </button>
          {selectedDoc && (
            <>
              <button
                onClick={handlePreview}
                className="rounded-md border border-white/20 bg-black/50 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
              >
                Preview HTML
              </button>
              {selectedDoc.pdf_storage_path ? (
                <button
                  onClick={handleViewPdf}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  View PDF
                </button>
              ) : (
                <button
                  onClick={handleRenderPdf}
                  disabled={renderingPdf}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renderingPdf ? "Rendering..." : "Generate PDF"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!selectedDoc ? (
        <div className="rounded-lg border border-white/10 bg-black/50 p-6 text-center">
          <p className="text-sm text-gray-400">
            No memo generated yet. Click "Generate Memo JSON" to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Document selector */}
          {documents.length > 1 && (
            <select
              value={selectedDoc.id}
              onChange={(e) => {
                const doc = documents.find((d) => d.id === e.target.value);
                if (doc) setSelectedDoc(doc);
              }}
              className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} - {new Date(doc.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          )}

          {/* View mode tabs */}
          <div className="flex gap-2 border-b border-white/10">
            <button
              onClick={() => setViewMode("outline")}
              className={`px-4 py-2 text-sm font-medium ${
                viewMode === "outline"
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Outline
            </button>
            <button
              onClick={() => setViewMode("json")}
              className={`px-4 py-2 text-sm font-medium ${
                viewMode === "json"
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              JSON
            </button>
          </div>

          {/* Content viewer */}
          <div className="max-h-[600px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-4">
            {viewMode === "outline" ? (
              <MemoOutline content={selectedDoc.content_json} />
            ) : (
              <pre className="text-xs text-gray-300">
                {JSON.stringify(selectedDoc.content_json, null, 2)}
              </pre>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Status: {selectedDoc.status} • Created: {new Date(selectedDoc.created_at).toLocaleString()}
            </span>
            {selectedDoc.content_json?.references?.facts_hash && (
              <span>Hash: {selectedDoc.content_json.references.facts_hash}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoOutline({ content }: { content: any }) {
  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <section>
        <h4 className="font-semibold text-white">Header</h4>
        <div className="mt-2 space-y-1 text-gray-300">
          <p>Deal: {content.header?.deal_name}</p>
          <p>Borrower: {content.header?.borrower}</p>
          <p>Date: {content.header?.date}</p>
          <p>Request: {content.header?.request_summary}</p>
        </div>
      </section>

      {/* Executive Summary */}
      <section>
        <h4 className="font-semibold text-white">Executive Summary</h4>
        <p className="mt-2 text-gray-300">{content.executive_summary?.narrative}</p>
        {content.executive_summary?.key_risks?.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-400">Key Risks:</p>
            <ul className="ml-4 list-disc text-gray-300">
              {content.executive_summary.key_risks.map((risk: string, i: number) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Financial Analysis */}
      {content.financial_analysis && (
        <section>
          <h4 className="font-semibold text-white">Financial Analysis</h4>
          <div className="mt-2 space-y-1 text-gray-300">
            <p>NOI: {formatCurrency(content.financial_analysis.noi)}</p>
            <p>DSCR: {content.financial_analysis.dscr?.toFixed(2) ?? "N/A"}x</p>
          </div>
        </section>
      )}

      {/* Risk Factors */}
      {content.risk_factors?.length > 0 && (
        <section>
          <h4 className="font-semibold text-white">Risk Factors</h4>
          <ul className="mt-2 space-y-2">
            {content.risk_factors.map((rf: any, i: number) => (
              <li key={i} className="rounded border border-white/10 bg-black/20 p-2">
                <p className="font-medium text-white">
                  {rf.risk} <span className="text-xs text-gray-400">({rf.severity})</span>
                </p>
                {rf.mitigants?.length > 0 && (
                  <ul className="ml-4 mt-1 list-disc text-xs text-gray-400">
                    {rf.mitigants.map((m: string, j: number) => (
                      <li key={j}>{m}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Proposed Terms */}
      {content.proposed_terms && (
        <section>
          <h4 className="font-semibold text-white">Proposed Terms</h4>
          <div className="mt-2 space-y-1 text-gray-300">
            <p>Product: {content.proposed_terms.product}</p>
            <p>Rate: {(content.proposed_terms.rate.all_in_rate * 100).toFixed(2)}%</p>
            <p>Rationale: {content.proposed_terms.rationale}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
