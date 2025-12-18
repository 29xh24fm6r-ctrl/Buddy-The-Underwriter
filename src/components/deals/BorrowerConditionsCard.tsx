"use client";

import React, { useEffect, useState } from "react";

interface Condition {
  id: string;
  title: string;
  severity: "REQUIRED" | "IMPORTANT" | "FYI";
  status: string;
  ai_explanation: string | null;
}

export default function BorrowerConditionsCard() {
  const [dealId, setDealId] = useState<string | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/borrower/active-deal", { cache: "no-store" });
        const j = await r.json();
        if (j?.ok) {
          setDealId(j.dealId);
          await loadConditions(j.dealId);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function loadConditions(id: string) {
    const r = await fetch(`/api/deals/${id}/conditions`, { cache: "no-store" });
    const j = await r.json();
    if (j?.ok) {
      setConditions(j.conditions ?? []);
    }
  }

  if (loading) {
    return <div className="border rounded p-4">Loading checklist…</div>;
  }

  if (!dealId) {
    return (
      <div className="border rounded p-4 text-gray-600">
        No active loan application found. Contact your underwriter.
      </div>
    );
  }

  const outstanding = conditions.filter((c) => c.status !== "satisfied");
  const completed = conditions.filter((c) => c.status === "satisfied");
  const completionPct = conditions.length
    ? Math.round((completed.length / conditions.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      <div className="border rounded-lg p-4 bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Completion Progress</span>
          <span className="text-sm text-gray-600">{completionPct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {completed.length} of {conditions.length} conditions satisfied
        </div>
      </div>

      {/* Outstanding Conditions */}
      {outstanding.length > 0 && (
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="font-semibold mb-3">Outstanding Items</h3>
          <div className="space-y-3">
            {outstanding.map((c) => (
              <div
                key={c.id}
                className={`border-l-4 p-3 rounded ${
                  c.severity === "REQUIRED"
                    ? "border-red-500 bg-red-50"
                    : c.severity === "IMPORTANT"
                    ? "border-yellow-500 bg-yellow-50"
                    : "border-blue-500 bg-blue-50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{c.title}</div>
                    {c.ai_explanation && (
                      <div className="text-sm text-gray-700 mt-1">
                        {c.ai_explanation}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-2">
                      Severity: {c.severity}
                    </div>
                  </div>
                  <button
                    className="ml-4 px-3 py-1 bg-black text-white text-xs rounded hover:opacity-90"
                    onClick={() => {
                      // TODO: Launch upload flow for this condition
                      alert(`Upload flow for condition ${c.id} - coming soon`);
                    }}
                  >
                    Upload
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Conditions */}
      {completed.length > 0 && (
        <details className="border rounded-lg p-4 bg-white">
          <summary className="font-semibold cursor-pointer">
            Completed Items ({completed.length})
          </summary>
          <div className="mt-3 space-y-2">
            {completed.map((c) => (
              <div key={c.id} className="text-sm text-gray-600 flex items-center">
                <span className="text-green-600 mr-2">✓</span>
                {c.title}
              </div>
            ))}
          </div>
        </details>
      )}

      {conditions.length === 0 && (
        <div className="border rounded p-4 text-gray-600">
          No conditions found. Your loan application may not be ready yet.
        </div>
      )}
    </div>
  );
}
