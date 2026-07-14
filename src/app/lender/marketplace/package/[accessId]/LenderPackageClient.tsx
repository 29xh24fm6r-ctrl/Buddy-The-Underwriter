"use client";

import * as React from "react";

type PackageResource = {
  type: string;
  label: string;
  available: boolean;
  downloadKey: string | null;
};

type DealSummary = {
  loanAmount: number | null;
  program: string | null;
  termMonths: number | null;
  score: number | null;
  band: string | null;
  state: string | null;
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

export function LenderPackageClient({ accessId }: { accessId: string }) {
  const [dealId, setDealId] = React.useState<string | null>(null);
  const [accessLevel, setAccessLevel] = React.useState<string | null>(null);
  const [dealSummary, setDealSummary] = React.useState<DealSummary | null>(null);
  const [resources, setResources] = React.useState<PackageResource[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = React.useState<string | null>(null);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/lender/marketplace/package/${accessId}`, { cache: "no-store" });
        if (res.status === 404) throw new Error("no_access");
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setDealId(json.dealId ?? null);
        setAccessLevel(json.accessLevel ?? null);
        setDealSummary(json.dealSummary ?? null);
        setResources(json.manifest?.resources ?? []);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [accessId]);

  const downloadResource = async (kind: string) => {
    if (!dealId || downloadingKey) return;
    setDownloadingKey(kind);
    setDownloadError(null);
    try {
      const res = await fetch(
        `/api/brokerage/deals/${dealId}/trident/download/${kind}?accessId=${encodeURIComponent(accessId)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDownloadError(body?.error ?? "Download failed");
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
          setDownloadError(data.error ?? "Download failed");
        }
      } else {
        // credit_memo — the route streams the PDF bytes directly (rendered
        // on demand, no pre-generated file to sign a URL for).
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch {
      setDownloadError("Network error");
    } finally {
      setDownloadingKey(null);
    }
  };

  if (loading) return <div className="p-8 text-sm text-neutral-500">Loading package…</div>;

  if (err) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Loan package</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {err === "no_access"
            ? "You do not have access to this package. Access is granted only after the borrower selects your institution."
            : `Could not load package: ${err}`}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold">Loan package</h1>
      <p className="mt-1 text-xs text-neutral-500">Access level: {accessLevel ?? "—"}</p>

      {dealSummary && (
        <dl className="mt-4 grid grid-cols-2 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm sm:grid-cols-3">
          <dt className="text-neutral-500">Loan amount</dt>
          <dd className="font-medium text-neutral-900">
            {dealSummary.loanAmount != null ? `$${dealSummary.loanAmount.toLocaleString()}` : "—"}
          </dd>
          <dt className="text-neutral-500">Program</dt>
          <dd className="font-medium text-neutral-900">{dealSummary.program ?? "—"}</dd>
          <dt className="text-neutral-500">Term</dt>
          <dd className="font-medium text-neutral-900">
            {dealSummary.termMonths != null ? `${dealSummary.termMonths} mo` : "—"}
          </dd>
          <dt className="text-neutral-500">Score</dt>
          <dd className="font-medium text-neutral-900">
            {dealSummary.score != null ? dealSummary.score : "—"}
            {dealSummary.band ? ` (${dealSummary.band.replace(/_/g, " ")})` : ""}
          </dd>
          <dt className="text-neutral-500">State</dt>
          <dd className="font-medium text-neutral-900">{dealSummary.state ?? "—"}</dd>
        </dl>
      )}

      <h2 className="mt-6 text-sm font-semibold text-neutral-900">Documents</h2>
      {downloadError && <p className="mt-2 text-sm text-rose-600">{downloadError}</p>}
      <ul className="mt-2 space-y-2">
        {(resources ?? [])
          .filter((r) => DOWNLOADABLE_KINDS.has(r.type))
          .map((r) => (
            <li
              key={r.type}
              className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"
            >
              <span className="text-sm font-medium text-neutral-800">{r.label}</span>
              {r.available && r.downloadKey ? (
                <button
                  onClick={() => downloadResource(r.downloadKey!)}
                  disabled={downloadingKey !== null}
                  className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-900 disabled:opacity-50"
                  type="button"
                >
                  {downloadingKey === r.downloadKey ? "Preparing…" : "Download"}
                </button>
              ) : (
                <span className="text-xs text-neutral-400">Not yet available</span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}
