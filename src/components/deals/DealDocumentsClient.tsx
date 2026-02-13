"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { directDealDocumentUpload } from "@/lib/uploads/uploadFile";
import { getChecklistBadge, getPipelineBadge, TONE_CLS } from "./documents/badges";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DealDocument = {
  id: string;
  name: string;
  display_name: string;
  original_filename: string;
  document_type: string | null;
  canonical_type: string | null;
  doc_year: number | null;
  mime_type: string;
  size_bytes: number;
  checklist_key: string | null;
  source: string | null;
  created_at: string;
  finalized_at: string | null;
  virus_status: string | null;
  classification_confidence: number | null;
  entity_name: string | null;
  match_confidence: number | null;
  match_source: string | null;
  artifact_status: string | null;
  artifact_error: string | null;
};

type SourceFilter = "all" | "banker" | "borrower";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  if (source === "internal" || source === "banker") return "Banker";
  if (source === "borrower" || source === "portal" || source === "borrower_portal") return "Borrower";
  return source;
}

function sourceBadgeCls(source: string | null): string {
  const label = sourceLabel(source);
  if (label === "Banker") return "bg-blue-500/20 text-blue-300 border-blue-500/30";
  if (label === "Borrower") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return "bg-white/10 text-white/60 border-white/10";
}

function virusBadge(status: string | null): { label: string; cls: string } | null {
  if (!status || status === "clean") return null;
  if (status === "pending") return { label: "Scanning", cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" };
  if (status === "infected") return { label: "Infected", cls: "bg-red-500/20 text-red-300 border-red-500/30" };
  if (status === "scan_failed") return { label: "Scan Failed", cls: "bg-red-500/20 text-red-300 border-red-500/30" };
  return null;
}

// ---------------------------------------------------------------------------
// Upload Drop Zone
// ---------------------------------------------------------------------------

function UploadDropZone({
  dealId,
  uploading,
  onUploadStart,
  onUploadDone,
}: {
  dealId: string;
  uploading: boolean;
  onUploadStart: () => void;
  onUploadDone: (error?: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    onUploadStart();
    const fileArr = Array.from(files);
    let lastError: string | undefined;

    for (const file of fileArr) {
      const result = await directDealDocumentUpload({
        dealId,
        file,
        source: "internal",
      });
      if (!result.ok) {
        lastError = result.error;
      }
    }

    onUploadDone(lastError);
  }

  return (
    <div
      className={[
        "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
        dragOver
          ? "border-blue-400 bg-blue-500/10"
          : "border-white/15 bg-white/5 hover:border-white/25",
      ].join(" ")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <div className="text-sm text-white/70">Uploading...</div>
      ) : (
        <>
          <div className="text-sm font-medium text-white/80">
            Drop files here or{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
            >
              browse
            </button>
          </div>
          <div className="mt-1 text-xs text-white/50">
            Files will be uploaded as banker documents and enter the classification pipeline.
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DealDocumentsClient
// ---------------------------------------------------------------------------

export default function DealDocumentsClient({ dealId }: { dealId: string }) {
  const [docs, setDocs] = useState<DealDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/documents`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load documents");
      setDocs(json.documents ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  // Derive unique document types for filter dropdown
  const docTypes = Array.from(
    new Set(docs.map((d) => d.document_type).filter(Boolean) as string[]),
  ).sort();

  // Apply filters
  const filtered = docs.filter((d) => {
    if (sourceFilter === "banker" && sourceLabel(d.source) !== "Banker") return false;
    if (sourceFilter === "borrower" && sourceLabel(d.source) !== "Borrower") return false;
    if (typeFilter && d.document_type !== typeFilter) return false;
    return true;
  });

  const filterBtnCls = (active: boolean) =>
    [
      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-white/10 text-white border-white/20"
        : "text-white/50 border-white/10 hover:text-white/70 hover:bg-white/5",
    ].join(" ");

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-white">Documents</h1>
        <p className="mt-1 text-sm text-white/70">
          All documents for this deal. Upload banker files or review borrower submissions.
        </p>
      </div>

      {/* Upload Zone */}
      <div className="mb-6">
        <UploadDropZone
          dealId={dealId}
          uploading={uploading}
          onUploadStart={() => setUploading(true)}
          onUploadDone={(err) => {
            setUploading(false);
            if (err) setError(err);
            load();
          }}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button className={filterBtnCls(sourceFilter === "all")} onClick={() => setSourceFilter("all")}>
            All ({docs.length})
          </button>
          <button className={filterBtnCls(sourceFilter === "banker")} onClick={() => setSourceFilter("banker")}>
            Banker
          </button>
          <button className={filterBtnCls(sourceFilter === "borrower")} onClick={() => setSourceFilter("borrower")}>
            Borrower
          </button>
        </div>

        {docTypes.length > 0 && (
          <select
            className="ml-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 focus:border-blue-400 focus:outline-none"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {docTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
          Loading documents...
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-white/15 p-8 text-center">
          <div className="text-sm font-medium text-white/60">No documents found</div>
          <div className="mt-1 text-xs text-white/40">
            {docs.length > 0 ? "Try adjusting your filters." : "Upload files above to get started."}
          </div>
        </div>
      )}

      {/* Document Table */}
      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/40">
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Match</th>
                <th className="px-4 py-3 font-medium">Pipeline</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => {
                const matchBdg = getChecklistBadge(doc);
                const pipeBdg = getPipelineBadge(doc);
                const vBadge = virusBadge(doc.virus_status);
                return (
                  <tr
                    key={doc.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/deals/${dealId}/documents/${doc.id}`}
                        className="text-sm font-medium text-white hover:text-blue-300"
                      >
                        {doc.display_name || doc.original_filename}
                      </Link>
                      {doc.entity_name && (
                        <div className="mt-0.5 text-[11px] text-white/40 truncate max-w-[200px]">
                          {doc.entity_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-white/70">
                        {doc.document_type?.replace(/_/g, " ") ?? "—"}
                      </div>
                      {doc.canonical_type && doc.canonical_type !== doc.document_type && (
                        <div className="mt-0.5 text-[10px] text-white/40">
                          {doc.canonical_type.replace(/_/g, " ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {doc.doc_year ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          sourceBadgeCls(doc.source),
                        ].join(" ")}
                      >
                        {sourceLabel(doc.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          TONE_CLS[matchBdg.tone],
                        ].join(" ")}
                      >
                        {matchBdg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          TONE_CLS[pipeBdg.tone],
                        ].join(" ")}
                        title={pipeBdg.hoverText}
                      >
                        {pipeBdg.label}
                      </span>
                      {vBadge && (
                        <span
                          className={[
                            "ml-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            vBadge.cls,
                          ].join(" ")}
                        >
                          {vBadge.label}
                        </span>
                      )}
                      {pipeBdg.tone === "red" && pipeBdg.hoverText && (
                        <div className="mt-0.5 text-[10px] text-red-400 truncate max-w-[180px]" title={pipeBdg.hoverText}>
                          {pipeBdg.hoverText}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {fmtSize(doc.size_bytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {fmtRelativeTime(doc.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
