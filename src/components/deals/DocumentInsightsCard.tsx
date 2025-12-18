"use client";

import { useEffect, useState } from "react";

interface OcrResult {
  id: string;
  attachment_id: string;
  extracted_text?: string;
  extracted_tables?: any;
  confidence_score?: number;
  created_at: string;
}

interface DocumentInsightsCardProps {
  dealId: string;
}

export default function DocumentInsightsCard({ dealId }: DocumentInsightsCardProps) {
  const [results, setResults] = useState<OcrResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        // TODO: Create proper API endpoint for OCR results by deal
        // For now, this is a placeholder
        const res = await fetch(`/api/deals/${dealId}/ocr/results`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch (err) {
        console.error("Error fetching OCR results:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [dealId]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const latestResults = results.slice(0, 5);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <h3 className="font-semibold text-sm mb-1">Document Insights</h3>
        <p className="text-xs text-gray-600">Latest OCR results & extracted data</p>
      </div>

      {latestResults.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 mb-2">No OCR results yet</p>
          <p className="text-xs text-gray-400">Upload documents and run OCR to see insights</p>
        </div>
      ) : (
        <div className="space-y-3">
          {latestResults.map((result) => (
            <div key={result.id} className="p-3 rounded border border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  Doc {result.attachment_id.substring(0, 8)}...
                </span>
                {result.confidence_score && (
                  <span className="text-xs text-gray-600">
                    {Math.round(result.confidence_score * 100)}% confidence
                  </span>
                )}
              </div>

              {result.extracted_text && (
                <p className="text-xs text-gray-600 line-clamp-3">
                  {result.extracted_text.substring(0, 200)}
                  {result.extracted_text.length > 200 ? "..." : ""}
                </p>
              )}

              {result.extracted_tables && (
                <div className="mt-2 text-xs text-blue-600">
                  ✓ Tables extracted ({JSON.stringify(result.extracted_tables).length} bytes)
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Highlights Placeholder */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs font-medium text-gray-700 mb-2">Key Findings</p>
        <p className="text-xs text-gray-500 italic">AI insights coming soon</p>
      </div>
    </div>
  );
}
