"use client";

/**
 * SealPackageCard — portal UI that surfaces:
 *   - gate reasons when canSeal = false (borrower sees what's blocking)
 *   - seal button when canSeal = true and not yet sealed
 *   - listing status + cadence countdown when already sealed
 *   - unseal button while status='pending_preview'
 *
 * NOTE: Sprint 5 spec mentioned "SealPackageCard.tsx added to /start"
 * but truncated before the component body. Built to the shape implied by
 * the seal-status endpoint contract + Sprint 1 StartConciergeClient's
 * visual grammar. Flag for eyeball pass.
 */

import { useEffect, useState } from "react";

type SealStatus = {
  ok: boolean;
  sealed: boolean;
  canSeal: boolean;
  gateReasons: string[];
  listing?: {
    id: string;
    status: string;
    score: number;
    band: string;
    publishedRateBps: number;
    previewOpensAt: string;
    claimOpensAt: string;
    claimClosesAt: string;
    matchedLenderCount: number;
  };
};

export function SealPackageCard({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<SealStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch(
        `/api/brokerage/deals/${dealId}/seal-status`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setError("Could not load seal status");
        return;
      }
      const data = (await res.json()) as SealStatus;
      setStatus(data);
      setError(null);
    } catch {
      setError("Network error");
    }
  };

  useEffect(() => {
    void load();
  }, [dealId]);

  const seal = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/seal`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Seal failed");
      } else {
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const unseal = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/seal`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Unseal failed");
      } else {
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading package status…
      </div>
    );
  }

  if (status.sealed && status.listing) {
    const l = status.listing;
    return (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            Package sealed — on the marketplace
          </h3>
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
            {l.status}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm text-slate-700">
          <dt>Buddy SBA Score</dt>
          <dd className="text-slate-900 font-medium">
            {l.score} ({l.band.replace("_", " ")})
          </dd>
          <dt>Published rate spread</dt>
          <dd className="text-slate-900 font-medium">
            +{l.publishedRateBps} bps over prime
          </dd>
          <dt>Preview opens</dt>
          <dd className="text-slate-900">
            {new Date(l.previewOpensAt).toLocaleString()}
          </dd>
          <dt>Claim window</dt>
          <dd className="text-slate-900">
            {new Date(l.claimOpensAt).toLocaleString()} —{" "}
            {new Date(l.claimClosesAt).toLocaleString()}
          </dd>
          <dt>Matched lenders</dt>
          <dd className="text-slate-900">{l.matchedLenderCount}</dd>
        </dl>
        {l.status === "pending_preview" && (
          <div className="mt-4">
            <button
              onClick={unseal}
              disabled={busy}
              className="text-sm font-medium text-rose-700 hover:text-rose-800 disabled:opacity-50"
              type="button"
            >
              {busy ? "Working…" : "Unseal and make changes"}
            </button>
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm text-rose-600">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        Seal your package for the marketplace
      </h3>
      <p className="text-sm text-slate-600 mb-4">
        Once you seal, up to 3 matched lenders can review your deal. Your
        identity stays hidden until you pick one.
      </p>
      {status.canSeal ? (
        <>
          <button
            onClick={seal}
            disabled={busy}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            type="button"
          >
            {busy ? "Sealing…" : "Seal package"}
          </button>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700 mb-2">
            A few things to finish first:
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            {status.gateReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
