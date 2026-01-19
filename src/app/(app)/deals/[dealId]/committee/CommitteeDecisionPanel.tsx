"use client";

import { useState } from "react";

export default function CommitteeDecisionPanel({ dealId }: { dealId: string }) {
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDecision = async (d: "approve" | "decline") => {
    if (!confirm(`Are you sure you want to ${d} this deal?`)) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: d }),
      });

      if (!res.ok) {
        throw new Error(`Decision failed: ${res.status}`);
      }

      setDecision(d);
      alert(`Deal ${d}d successfully`);
    } catch (e: any) {
      alert(`Error: ${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {!decision && (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Committee Decision
          </h2>

          <div className="flex gap-4">
            <button
              onClick={() => handleDecision("approve")}
              disabled={submitting}
              className="flex-1 rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Processing..." : "Approve"}
            </button>

            <button
              onClick={() => handleDecision("decline")}
              disabled={submitting}
              className="flex-1 rounded-lg bg-red-600 px-6 py-3 font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Processing..." : "Decline"}
            </button>
          </div>

          <p className="mt-4 text-sm text-gray-500">
            This is the only write action available in committee view.
            All other data is read-only.
          </p>
        </div>
      )}

      {decision && (
        <div className="rounded-lg bg-white p-6 shadow">
          <div
            className={`text-center text-lg font-semibold ${
              decision === "approve" ? "text-green-600" : "text-red-600"
            }`}
          >
            Deal {decision === "approve" ? "Approved" : "Declined"}
          </div>
        </div>
      )}
    </>
  );
}
