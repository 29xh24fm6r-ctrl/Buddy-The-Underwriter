"use client";

import { useEffect, useState } from "react";

type LenderDealData = {
  deal: {
    id: string;
    borrower_name: string;
    amount: number;
    ready_at: string | null;
    ready_reason: string | null;
    submitted_at: string | null;
    created_at: string;
  };
  checklist_summary: {
    required: number;
    satisfied: number;
  };
  documents: Array<{
    id: string;
    original_filename: string;
    uploaded_at: string;
    finalized_at: string | null;
  }>;
  timeline: Array<{
    stage: string;
    status: string;
    payload: any;
    created_at: string;
  }>;
};

export default function LenderDealViewClient({ dealId }: { dealId: string }) {
  const [data, setData] = useState<LenderDealData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/lender/deals/${dealId}`);
        const json = await res.json();

        if (!json.ok) {
          throw new Error(json.error || "Failed to load deal");
        }

        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dealId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-gray-600">Loading deal...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error || "Failed to load deal"}
          </div>
        </div>
      </div>
    );
  }

  const { deal, checklist_summary, documents, timeline } = data;

  // Readiness banner logic
  let bannerColor = "bg-amber-50 border-amber-200 text-amber-900";
  let bannerIcon = "⏳";
  let bannerText = deal.ready_reason || "Not ready";

  if (deal.submitted_at) {
    bannerColor = "bg-blue-50 border-blue-200 text-blue-900";
    bannerIcon = "📦";
    bannerText = `Submitted ${new Date(deal.submitted_at).toLocaleDateString()}`;
  } else if (deal.ready_at) {
    bannerColor = "bg-green-50 border-green-200 text-green-900";
    bannerIcon = "✅";
    bannerText = "Deal Ready";
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{deal.borrower_name}</h1>
          <div className="text-sm text-gray-600 mt-1">
            ${deal.amount?.toLocaleString() || "N/A"} • Created {new Date(deal.created_at).toLocaleDateString()}
          </div>
        </div>

        {/* Readiness Banner */}
        <div className={`rounded-lg border p-4 ${bannerColor}`}>
          <div className="flex items-center gap-3">
            <div className="text-2xl">{bannerIcon}</div>
            <div>
              <div className="font-semibold">{bannerText}</div>
              {deal.ready_at && !deal.submitted_at && (
                <div className="text-xs mt-1">Ready since {new Date(deal.ready_at).toLocaleString()}</div>
              )}
            </div>
          </div>
        </div>

        {/* Checklist Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Checklist Summary</h2>
          <div className="flex items-center gap-4">
            <div className="text-3xl font-bold text-gray-900">
              {checklist_summary.satisfied}/{checklist_summary.required}
            </div>
            <div className="text-sm text-gray-600">Required items satisfied</div>
          </div>
        </div>

        {/* Documents */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Documents ({documents.length})</h2>
          {documents.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No documents uploaded</div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="text-sm text-gray-900">{doc.original_filename}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(doc.uploaded_at).toLocaleDateString()}
                    {doc.finalized_at && " • Finalized"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timeline (Ledger) */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h2>
          {timeline.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No events yet</div>
          ) : (
            <div className="space-y-3">
              {timeline.map((event, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="text-xs text-gray-500 w-32">
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900 capitalize">
                      {event.stage} • {event.status}
                    </div>
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <div className="text-xs text-gray-600 mt-1">
                        {JSON.stringify(event.payload, null, 2)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
