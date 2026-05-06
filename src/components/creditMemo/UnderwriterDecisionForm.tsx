"use client";

import React, { useState } from "react";

type Decision = "approved" | "declined" | "returned_for_revision";

type Props = {
  dealId: string;
  snapshotId: string;
  currentStatus: "banker_submitted" | "underwriter_review" | "finalized" | "returned";
};

export default function UnderwriterDecisionForm({ dealId, snapshotId, currentStatus }: Props) {
  const [decision, setDecision] = useState<Decision>("approved");
  const [summary, setSummary] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string } | null>(null);

  const isLocked = currentStatus === "finalized" || currentStatus === "returned";

  const submit = async () => {
    if (summary.trim().length === 0) {
      setError("Decision summary is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/credit-memo/underwriter-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId,
          decision,
          summary,
          requested_changes: [],
          conditions: [],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult({ status: data.status });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  if (isLocked || result) {
    const finalStatus = result?.status ?? currentStatus;
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="text-sm font-semibold text-emerald-800">
          Decision recorded — status: {finalStatus}
        </div>
        <div className="mt-1 text-xs text-emerald-700">
          The submitted snapshot is frozen. Any further revision creates a new memo version.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-gray-900">Underwriter Decision</div>

      <label className="block mb-2 text-[11px] font-semibold text-gray-600 uppercase">
        Decision
      </label>
      <select
        value={decision}
        onChange={(e) => setDecision(e.target.value as Decision)}
        className="mb-3 w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-900"
        disabled={submitting}
      >
        <option value="approved">Approve</option>
        <option value="returned_for_revision">Return for revision</option>
        <option value="declined">Decline</option>
      </select>

      <label className="block mb-2 text-[11px] font-semibold text-gray-600 uppercase">
        Decision summary (required)
      </label>
      <textarea
        rows={4}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Rationale, conditions, and notes for the banker."
        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-900 resize-none mb-3"
        disabled={submitting}
      />

      {error && (
        <div className="mb-3 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitting || summary.trim().length === 0}
          onClick={submit}
          className="text-xs font-semibold px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {submitting ? "Recording…" : "Record decision"}
        </button>
      </div>
    </div>
  );
}
