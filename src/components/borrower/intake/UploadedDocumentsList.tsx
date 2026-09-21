"use client";

import { useCallback, useEffect, useState } from "react";
import { BORROWER_DOCUMENT_TYPES } from "@/lib/borrower/documents/admission";

type BorrowerDocument = {
  id: string;
  filename: string;
  label: string;
  category: string;
  uploadedAt: string | null;
  sizeBytes: number | null;
  status: string;
  processingComplete?: boolean;
  actionMessage?: string | null;
  canClarify?: boolean;
  canRetry?: boolean;
  suggestedType?: string | null;
  taxYear?: number | null;
};

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function UploadedDocumentsList({
  token,
  refreshKey = 0,
  heading = "Documents you've already sent",
}: {
  token: string;
  /** Bump to re-read after an upload completes. */
  refreshKey?: number;
  heading?: string;
}) {
  const [documents, setDocuments] = useState<BorrowerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borrower/portal/${token}/documents`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok && Array.isArray(json.documents)) {
        setDocuments(json.documents);
        setFailed(false);
      } else {
        // A failed read is not an empty list. Showing "no documents yet"
        // here is what invites the borrower to upload a seventh copy.
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    // Resume eligible documents parked by older deployments; the server scopes
    // admission and the existing artifact worker owns all processing.
    void fetch(`/api/borrower/portal/${token}/documents/process`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }).then((response) => { if (!response.ok && !cancelled) setResumeFailed(true); })
      .catch(() => { if (!cancelled) setResumeFailed(true); });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load, refreshKey, token]);

  if (loading) {
    return (
      <p className="text-xs text-slate-500">
        Checking what you&apos;ve already sent...
      </p>
    );
  }

  if (failed) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-xs text-rose-700">
          We could not load your uploaded documents.
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No documents on your application yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {resumeFailed && <p role="alert" className="text-xs text-amber-800">Buddy could not resume document processing. Refresh this page to retry; your uploads are saved.</p>}
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {heading} ({documents.length})
      </p>
      <ul className="space-y-1.5">
        {documents.map((d) => {
          const failed = [
            "error",
            "failed",
            "processing_failed",
            "rejected",
          ].includes(d.status);
          const processing = ["processing", "pending", "queued"].includes(
            d.status,
          );
          const statusLabel = d.processingComplete
            ? "Processed by Buddy — added to your application"
            : d.actionMessage ?? (failed
              ? (d.canRetry ? "Processing stopped. You can retry below." : "Processing stopped.")
              : processing ? "Buddy is reading and organizing this document…"
                : "Buddy is checking this document.");
          const meta = [formatSize(d.sizeBytes), formatDate(d.uploadedAt)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={failed ? "text-amber-700" : "text-sky-700"}
                >
                  {failed ? "!" : "✓"}
                </span>
                <span
                  className="truncate text-sm text-slate-800"
                  title={d.label}
                >
                  {d.label}
                  <span className="block whitespace-normal text-xs font-normal text-slate-600">
                    {statusLabel}
                  </span>
                </span>
              </div>
              {meta && (
                <span className="shrink-0 text-xs text-slate-500">{meta}</span>
              )}
              {(d.canClarify || d.canRetry) && <DocumentClarification document={d} token={token} onSaved={load} />}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">
        Buddy processes readable documents automatically. We’ll ask you here if a detail or a clearer copy is needed.
      </p>
    </div>
  );
}


function DocumentClarification({ document: doc, token, onSaved }: { document: BorrowerDocument; token: string; onSaved: () => Promise<void> }) {
  const [type, setType] = useState(BORROWER_DOCUMENT_TYPES.some(([value]) => value === doc.suggestedType) ? doc.suggestedType! : "");
  const [year, setYear] = useState(doc.taxYear ? String(doc.taxYear) : "");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tax = ["BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN"].includes(type);
  const financial = ["INCOME_STATEMENT", "BALANCE_SHEET"].includes(type);
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/borrower/portal/${token}/documents/process`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, ...(doc.canClarify ? { clarification: {
          doc_type: type, tax_year: tax ? Number(year) : null, statement_period: financial ? period : null,
        } } : {}) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not save. Please retry.");
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="w-full space-y-2 border-t border-slate-200 pt-2">
    {doc.canClarify && <>
      <label className="block text-sm">Document type
        <select aria-label={`Document type for ${doc.filename}`} value={type} onChange={(e) => { setType(e.target.value); setPeriod(""); }} className="ml-2 rounded border p-2" disabled={busy}>
          <option value="">Choose the type shown on your file</option>
          {BORROWER_DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {tax && <label className="block text-sm">Tax year
        <input aria-label={`Tax year for ${doc.filename}`} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} className="ml-2 w-24 rounded border p-2" disabled={busy} />
      </label>}
      {financial && <label className="block text-sm">Statement period
        <select aria-label={`Statement period for ${doc.filename}`} value={period} onChange={(e) => setPeriod(e.target.value)} className="ml-2 rounded border p-2" disabled={busy}>
          <option value="">Choose a period</option>
          {(type === "BALANCE_SHEET" ? [["CURRENT", "Current"], ["HISTORICAL", "Earlier period"]] : [["YTD", "Year to date"], ["ANNUAL", "Full year"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>}
    </>}
    <button type="button" disabled={busy || (!!doc.canClarify && (!type || (tax && !/^\d{4}$/.test(year)) || (financial && !period)))} onClick={() => void save()} className="rounded bg-sky-800 px-3 py-2 text-sm text-white disabled:opacity-50">
      {busy ? "Saving…" : doc.canClarify ? "Save detail and let Buddy continue" : "Retry processing"}
    </button>
    {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
  </div>;
}
