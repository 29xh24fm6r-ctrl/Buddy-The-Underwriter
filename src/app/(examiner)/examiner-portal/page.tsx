/**
 * Examiner Portal Landing Page.
 *
 * Validates the grant_id from query params and shows grant info.
 * No browsing — examiner must use a direct link with grant_id + deal_id.
 */
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type GrantInfo = {
  examiner_name: string;
  organization: string;
  expires_at: string;
  scope: { deal_ids: string[]; read_areas: string[] };
};

function ExaminerPortalPageContent() {
  const searchParams = useSearchParams();
  const grantId = searchParams?.get("grant_id") ?? null;

  const [grant, setGrant] = useState<GrantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!grantId) {
      setError("No grant_id provided. Use the link provided by the bank.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Validate grant by fetching a scoped deal (first deal in scope)
        const res = await fetch(
          `/api/examiner/grants?grant_id=${encodeURIComponent(grantId)}`,
        );
        const data = await res.json();
        if (data.ok && data.grant) {
          setGrant(data.grant);
        } else {
          setError(
            data.error?.message ?? "Grant not found, expired, or revoked.",
          );
        }
      } catch {
        setError("Unable to validate grant. Please check your link.");
      } finally {
        setLoading(false);
      }
    })();
  }, [grantId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Validating access...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-sm font-medium text-red-800 mb-1">
          Access Denied
        </div>
        <div className="text-xs text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Grant Info */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-2">Active Grant</div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-gray-900">
            {grant?.examiner_name}
          </div>
          <div className="text-xs text-gray-600">{grant?.organization}</div>
          <div className="text-xs text-gray-400">
            Expires: {grant?.expires_at ? new Date(grant.expires_at).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {/* Deal Links */}
      {grant?.scope.deal_ids && grant.scope.deal_ids.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-3">Accessible Deals</div>
          <div className="space-y-2">
            {grant.scope.deal_ids.map((dealId) => (
              <a
                key={dealId}
                href={`/examiner-portal/deals/${dealId}?grant_id=${grantId}`}
                className="block text-xs text-blue-600 hover:text-blue-800 font-mono bg-gray-50 rounded px-3 py-2"
              >
                {dealId}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Playbooks */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-2">Reference</div>
        <a
          href={`/examiner-portal/playbooks?grant_id=${grantId}`}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          View Examiner Playbooks
        </a>
      </div>
    </div>
  );
}

export default function ExaminerPortalPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 py-12 text-center">Loading...</div>}>
      <ExaminerPortalPageContent />
    </Suspense>
  );
}
