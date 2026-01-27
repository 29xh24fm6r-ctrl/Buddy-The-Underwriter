/**
 * Examiner Integrity Verification Page.
 *
 * Allows examiners to verify snapshot hashes inline.
 * Calls the verify endpoint which recomputes SHA-256 from canonical JSON.
 * Grant-scoped, all verification attempts logged.
 */
"use client";

import React, { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type VerificationResult = {
  check_version: string;
  checked_at: string;
  artifact_type: string;
  artifact_id: string;
  expected_hash: string;
  computed_hash: string;
  match: boolean;
  details: string;
};

export default function ExaminerIntegrityPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = (params?.dealId as string) ?? "";
  const grantId = searchParams?.get("grant_id") ?? "";

  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runVerification = async () => {
    if (!dealId || !grantId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/examiner/portal/deals/${dealId}/verify?grant_id=${encodeURIComponent(grantId)}`,
      );
      const json = await res.json();
      if (json.ok) {
        setResult(json.verification);
      } else {
        setError(json.error?.message ?? "Verification failed.");
      }
    } catch {
      setError("Unable to run verification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Integrity Verification
        </h2>
        <span className="text-[10px] text-gray-400">
          SHA-256 hash recomputation
        </span>
      </div>

      {/* Explanation */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-xs text-gray-600">
        This tool recomputes the SHA-256 hash of the decision snapshot from its
        canonical JSON representation and compares it against the stored hash.
        A match confirms the snapshot has not been modified since generation.
      </div>

      {/* Action */}
      <div>
        <button
          onClick={runVerification}
          disabled={loading || !grantId}
          className="text-xs px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Verify Snapshot Integrity"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={`border rounded-lg p-4 ${
            result.match
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`text-sm font-semibold ${
                result.match ? "text-green-800" : "text-red-800"
              }`}
            >
              {result.match ? "VERIFIED" : "MISMATCH"}
            </span>
            <span className="text-[10px] text-gray-400">
              {result.artifact_type} — {result.artifact_id?.slice(0, 8)}…
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div>
              <span className="text-gray-500">Expected: </span>
              <span className="text-gray-800 break-all">
                {result.expected_hash}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Computed: </span>
              <span className="text-gray-800 break-all">
                {result.computed_hash}
              </span>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-600">{result.details}</div>
          <div className="mt-1 text-[10px] text-gray-400">
            Checked at: {result.checked_at}
          </div>
        </div>
      )}

      <a
        href={`/examiner/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`}
        className="text-xs text-blue-600 hover:text-blue-800 inline-block"
      >
        ← Back to deal
      </a>
    </div>
  );
}
