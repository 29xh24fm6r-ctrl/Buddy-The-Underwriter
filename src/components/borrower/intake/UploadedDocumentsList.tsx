"use client";

/**
 * The documents this deal already holds, read from the EXISTING borrower
 * endpoint (GET /api/borrower/portal/[token]/documents).
 *
 * Nothing in the /start funnel rendered this. PortalUploadDropzone shows
 * only files from the current browser session, so a borrower who returned
 * to the application saw an empty uploader and reasonably concluded their
 * documents had not arrived — deal b296dec2 collected six identical copies
 * of the same tax return that way.
 *
 * This is deliberately a read-only view over the endpoint that already
 * exists; it introduces no second document system and no new route.
 */

import { useCallback, useEffect, useState } from "react";

type BorrowerDocument = {
  id: string;
  filename: string;
  label: string;
  category: string;
  uploadedAt: string | null;
  sizeBytes: number | null;
  status: string;
  /**
   * How many stored rows this entry stands for. The route collapses
   * identical copies (same sha256, or same filename+size when the older
   * rows have no hash), so deal b296dec2's six copies of
   * 2025_TaxReturn.pdf arrive as one entry with copies: 6.
   */
  copies?: number;
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

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) {
    return (
      <p className="text-xs text-slate-500">Checking what you&apos;ve already sent...</p>
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
          onClick={() => { setLoading(true); void load(); }}
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
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {heading} ({documents.length})
      </p>
      <ul className="space-y-1.5">
        {documents.map((d) => {
          const meta = [formatSize(d.sizeBytes), formatDate(d.uploadedAt)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-emerald-600">✓</span>
                <span className="truncate text-sm text-slate-800" title={d.label}>
                  {d.label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(d.copies ?? 1) > 1 && (
                  <span
                    className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                    title={`You sent this file ${d.copies} times — we're only counting it once.`}
                  >
                    sent {d.copies}×
                  </span>
                )}
                {meta && <span className="text-xs text-slate-500">{meta}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">
        These are already on your application — you don&apos;t need to send them again.
      </p>
    </div>
  );
}
