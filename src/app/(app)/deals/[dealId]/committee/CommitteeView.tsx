"use client";

import { useEffect, useState } from "react";
import type { DealContext, DealSnapshot } from "@/lib/deals/contextTypes";

export function CommitteeView({
  dealId,
  snapshotId,
}: {
  dealId: string;
  snapshotId?: string;
}) {
  const [context, setContext] = useState<DealContext | null>(null);
  const [snapshot, setSnapshot] = useState<DealSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Fetch context
        const contextRes = await fetch(`/api/deals/${dealId}/context`, {
          cache: "no-store",
        });

        if (!contextRes.ok) {
          throw new Error(`Failed to load deal context: ${contextRes.status}`);
        }

        const contextData = (await contextRes.json()) as DealContext;
        setContext(contextData);

        // Fetch snapshot if provided
        if (snapshotId) {
          const snapshotRes = await fetch(`/api/deals/${dealId}/snapshots`, {
            cache: "no-store",
          });

          if (snapshotRes.ok) {
            const { snapshots } = await snapshotRes.json();
            const found = snapshots?.find((s: any) => s.id === snapshotId);
            if (found) {
              setSnapshot({
                snapshotId: found.id,
                dealId: found.deal_id,
                immutable: true,
                createdAt: found.created_at,
                createdBy: found.created_by,
              });
            }
          }
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId, snapshotId]);

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-gray-600">Loading committee view...</div>
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-red-600">
          Error: {error ?? "Failed to load committee view"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Committee Review
            </h1>
            <p className="text-sm text-gray-500">
              {context.borrower.name} · {context.borrower.entityType}
            </p>
          </div>

          {snapshot && (
            <div className="rounded-lg bg-blue-50 px-4 py-2">
              <div className="text-xs text-blue-600">Snapshot</div>
              <div className="text-sm font-medium text-blue-900">
                {new Date(snapshot.createdAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stitch Embedded View (Read-only) */}
      <div className="p-6">
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <iframe
            src="/stitch/deal-summary"
            className="h-[600px] w-full border-0"
            title="Committee Deal Summary"
          />
        </div>

        {/* Decision Panel (Only Write Action) */}
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
      </div>
    </div>
  );
}
