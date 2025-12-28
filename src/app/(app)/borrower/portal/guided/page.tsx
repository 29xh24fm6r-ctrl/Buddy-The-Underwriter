/**
 * /borrower/portal/guided - Guided borrower submission UI
 * Uses existing portal token pattern
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function GuidedPortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [evidenceItems, setEvidenceItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/portal/${token}/guided/context`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setEvidenceItems(data.evidenceItems);
        }
        setLoading(false);
      });
  }, [token]);

  const handleConfirm = async (itemId: string, confirmed: boolean, correctedValue?: string) => {
    await fetch(`/api/portal/${token}/guided/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, confirmed, correctedValue }),
    });
    alert(confirmed ? "Confirmed!" : "Correction saved");
  };

  if (!token) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-red-600">Missing token. Please use the link from your email.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-gray-600">Loading your submission...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Guided Loan Submission</h1>
      <p className="text-gray-600">
        Please review and confirm the information we extracted from your documents.
      </p>

      {evidenceItems.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-gray-500">
          No evidence items to review yet. Upload your documents first.
        </div>
      ) : (
        <div className="space-y-4">
          {evidenceItems.map((item: any, idx: number) => (
            <div key={idx} className="border rounded-lg p-4 bg-white">
              <div className="font-semibold mb-2">{item.label || item.field}</div>
              <div className="text-gray-700 mb-3">Value: {item.value}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleConfirm(item.id || idx.toString(), true)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  ✓ Correct
                </button>
                <button
                  onClick={() => {
                    const corrected = prompt("Enter corrected value:");
                    if (corrected) handleConfirm(item.id || idx.toString(), false, corrected);
                  }}
                  className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
                >
                  ✎ Needs Correction
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuidedPortalPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto p-6 text-center"><p>Loading...</p></div>}>
      <GuidedPortalContent />
    </Suspense>
  );
}
