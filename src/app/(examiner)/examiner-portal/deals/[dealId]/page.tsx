/**
 * Examiner Deal Overview Page.
 *
 * Fetches scoped deal snapshot via the examiner portal API.
 * Shows navigation to sub-pages (borrower, decision, integrity, traces).
 * Grant-authenticated, read-only.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type DealSnapshot = {
  deal: Record<string, unknown>;
  borrower: Record<string, unknown>;
  bank: Record<string, unknown>;
  documents_count: number;
  signals_count: number;
};

type GrantInfo = {
  examiner_name: string;
  organization: string;
  expires_at: string;
};

export default function ExaminerDealPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dealId = (params?.dealId as string) ?? "";
  const grantId = searchParams?.get("grant_id") ?? "";

  const [snapshot, setSnapshot] = useState<DealSnapshot | null>(null);
  const [grant, setGrant] = useState<GrantInfo | null>(null);
  const [omegaAvailable, setOmegaAvailable] = useState(false);
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
        const data = await res.json();
        if (data.ok) {
          setSnapshot(data.snapshot);
          setGrant(data.grant);
          setOmegaAvailable(data.omega_available ?? false);
        } else {
          setError(data.error?.message ?? "Failed to load deal.");
        }
      } catch {
        setError("Unable to load deal.");
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId, grantId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Loading deal...
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

  const deal = snapshot?.deal as Record<string, unknown> | undefined;
  const borrower = snapshot?.borrower as Record<string, unknown> | undefined;
  const qs = `grant_id=${encodeURIComponent(grantId)}`;

  const subPages = [
    { label: "Borrower", href: `/examiner-portal/deals/${dealId}/borrower?${qs}` },
    { label: "Decision", href: `/examiner-portal/deals/${dealId}/decision?${qs}` },
    { label: "Integrity", href: `/examiner-portal/deals/${dealId}/integrity?${qs}` },
    { label: "Traces", href: `/examiner-portal/deals/${dealId}/traces?${qs}` },
  ];

  return (
    <div className="space-y-6">
      {/* Grant Badge */}
      {grant && (
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>
            {grant.examiner_name} — {grant.organization}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            Expires {new Date(grant.expires_at).toLocaleDateString()}
          </span>
          {omegaAvailable && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-green-600">Omega Connected</span>
            </>
          )}
        </div>
      )}

      {/* Deal Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-2">Deal Overview</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-gray-400">Deal ID:</span>{" "}
            <span className="font-mono text-gray-700">{dealId.slice(0, 8)}…</span>
          </div>
          <div>
            <span className="text-gray-400">Status:</span>{" "}
            <span className="text-gray-700">
              {String(deal?.lifecycle_phase ?? deal?.status ?? "—")}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Borrower:</span>{" "}
            <span className="text-gray-700">
              {String(borrower?.business_name ?? borrower?.name ?? "—")}
            </span>
          </div>
          <div>
            <span className="text-gray-400">Documents:</span>{" "}
            <span className="text-gray-700">
              {snapshot?.documents_count ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Sub-page Navigation */}
      <div className="grid grid-cols-2 gap-3">
        {subPages.map((page) => (
          <a
            key={page.label}
            href={page.href}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
          >
            <div className="text-sm font-medium text-gray-900">
              {page.label}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              View {page.label.toLowerCase()} data
            </div>
          </a>
        ))}
      </div>

      {/* Back Link */}
      <div>
        <a
          href={`/examiner-portal?grant_id=${encodeURIComponent(grantId)}`}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          ← Back to portal
        </a>
      </div>
    </div>
  );
}
