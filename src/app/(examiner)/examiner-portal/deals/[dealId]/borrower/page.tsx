/**
 * Examiner Borrower View — read-only borrower data.
 *
 * Shows borrower snapshot from the examiner portal API.
 * Grant-scoped, PII-masked, all access logged.
 */
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

function ExaminerBorrowerPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = (params?.dealId as string) ?? "";
  const grantId = searchParams?.get("grant_id") ?? "";

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId || !grantId) {
      setError("Missing deal_id or grant_id.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/examiner/portal/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`,
        );
        const json = await res.json();
        if (json.ok) {
          setData(json.snapshot);
        } else {
          setError(json.error?.message ?? "Failed to load borrower data.");
        }
      } catch {
        setError("Unable to load borrower data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId, grantId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Loading borrower data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-sm font-medium text-red-800 mb-1">Error</div>
        <div className="text-xs text-red-600">{error}</div>
      </div>
    );
  }

  const borrower = (data?.borrower ?? {}) as Record<string, unknown>;
  const deal = (data?.deal ?? {}) as Record<string, unknown>;

  const fields: Array<{ label: string; key: string; source: Record<string, unknown> }> = [
    { label: "Business Name", key: "business_name", source: borrower },
    { label: "Entity Type", key: "entity_type", source: borrower },
    { label: "State", key: "state_of_formation", source: borrower },
    { label: "EIN", key: "ein", source: borrower },
    { label: "NAICS", key: "naics_code", source: borrower },
    { label: "Years in Business", key: "years_in_business", source: borrower },
    { label: "Loan Amount", key: "loan_amount_requested", source: deal },
    { label: "Loan Purpose", key: "loan_purpose", source: deal },
    { label: "Lifecycle Phase", key: "lifecycle_phase", source: deal },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Borrower Data</h2>
        <span className="text-[10px] text-gray-400">Read-Only</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {fields.map(({ label, key, source }) => (
          <div key={key} className="px-4 py-2.5 flex justify-between text-xs">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-800 font-mono">
              {String(source[key] ?? "—")}
            </span>
          </div>
        ))}
      </div>

      {/* Owner / Attestation */}
      {!!borrower.owner_name && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-2">Owner Information</div>
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-gray-400">Owner:</span>{" "}
              <span className="text-gray-800">
                {String(borrower.owner_name)}
              </span>
            </div>
            {!!borrower.owner_attested_at && (
              <div>
                <span className="text-gray-400">Attested:</span>{" "}
                <span className="text-gray-800">
                  {new Date(String(borrower.owner_attested_at)).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <a
        href={`/examiner-portal/deals/${dealId}?grant_id=${encodeURIComponent(grantId)}`}
        className="text-xs text-blue-600 hover:text-blue-800 inline-block"
      >
        ← Back to deal
      </a>
    </div>
  );
}

export default function ExaminerBorrowerPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 py-12 text-center">Loading...</div>}>
      <ExaminerBorrowerPageContent />
    </Suspense>
  );
}
