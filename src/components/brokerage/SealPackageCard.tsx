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

type PackageResource = {
  type: string;
  label: string;
  available: boolean;
  downloadKey: string | null;
};

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
  claims?: Array<{ id: string; lenderName: string; claimedAt: string | null }>;
  manifest?: { resources: PackageResource[] } | null;
};

// The trident download dispatcher (/trident/download/[kind]) only knows how
// to serve these six kinds today. form_159 and source_docs exist as
// manifest resource types but have no working download endpoint yet —
// filtered out here rather than rendering a button that 404s.
const DOWNLOADABLE_KINDS = new Set([
  "business_plan",
  "projections_pdf",
  "projections_xlsx",
  "feasibility",
  "credit_memo",
  "sba_forms",
]);

export function SealPackageCard({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<SealStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

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

  const pickLender = async (claimId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/brokerage/deals/${dealId}/marketplace/pick`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimId }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        setError(data.error ?? "Could not select lender");
      } else {
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const downloadResource = async (kind: string) => {
    if (downloadingKey) return;
    setDownloadingKey(kind);
    setError(null);
    try {
      const res = await fetch(
        `/api/brokerage/deals/${dealId}/trident/download/${kind}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Download failed");
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        // business_plan / projections_pdf / projections_xlsx / feasibility —
        // a short-lived signed Storage URL.
        const data = await res.json();
        if (data.ok && data.url) {
          window.open(data.url, "_blank", "noopener,noreferrer");
        } else {
          setError(data.error ?? "Download failed");
        }
      } else {
        // credit_memo — the route streams the PDF bytes directly (rendered
        // on demand, no pre-generated file to sign a URL for).
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        // Give the new tab time to load the blob before revoking it.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch {
      setError("Network error");
    } finally {
      setDownloadingKey(null);
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

        {/* Borrower "pick a lender" step — the funnel dead-ended here before
            because there was no UI to select a lender that had claimed. */}
        {l.status === "awaiting_borrower_pick" && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-semibold text-slate-900 mb-1">
              Choose your lender
            </h4>
            {status.claims && status.claims.length > 0 ? (
              <>
                <p className="text-sm text-slate-600 mb-3">
                  {status.claims.length === 1
                    ? "A lender wants to fund your deal. Pick them to share your full package."
                    : `${status.claims.length} lenders want to fund your deal. Pick one to share your full package.`}
                </p>
                <ul className="space-y-2">
                  {status.claims.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-slate-800">
                        {c.lenderName}
                      </span>
                      <button
                        onClick={() => pickLender(c.id)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        type="button"
                      >
                        {busy ? "Working…" : "Choose this lender"}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Waiting for a lender to claim your deal. We&rsquo;ll notify you as
                soon as one does.
              </p>
            )}
          </div>
        )}

        {l.status === "picked" && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-emerald-700 mb-3">
              You&rsquo;ve chosen your lender. They now have full access to your
              package and will be in touch.
            </p>
            <h4 className="text-sm font-semibold text-slate-900 mb-2">
              Your documents
            </h4>
            {status.manifest ? (
              <ul className="space-y-2">
                {status.manifest.resources
                  .filter((r) => DOWNLOADABLE_KINDS.has(r.type))
                  .map((r) => (
                    <li
                      key={r.type}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-slate-800">
                        {r.label}
                      </span>
                      {r.available && r.downloadKey ? (
                        <button
                          onClick={() => downloadResource(r.downloadKey!)}
                          disabled={downloadingKey !== null}
                          className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
                          type="button"
                        >
                          {downloadingKey === r.downloadKey
                            ? "Preparing…"
                            : "Download"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Not yet available
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Loading documents…</p>
            )}
          </div>
        )}

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
