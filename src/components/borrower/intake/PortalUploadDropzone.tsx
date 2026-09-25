"use client";

// src/components/borrower/intake/PortalUploadDropzone.tsx
// Phase 85A.3 — Minimal drag-drop uploader wired for the borrower portal's
// token-auth flow (uploadBorrowerFile → /api/portal/[token]/files/sign + /record).
// Intentionally simpler than SmartUploadDropzone, which is Clerk-authed for
// banker-side usage.

import { useCallback, useState } from "react";
import { uploadBorrowerFile } from "@/lib/uploads/uploadFile";

type Props = {
  token: string;
  dealId: string;
  onUploadComplete?: () => void;
  selectedDocument?: { key: string; title: string } | null;
  onClearSelection?: () => void;
};

type UploadedFile = {
  id: string;
  file: File;
  name: string;
  checklistKey: string | null;
  status: "uploading" | "success" | "error";
  error?: string;
  /** Real byte-level percentage from uploadBorrowerFile's onProgress callback — not a fake animation. */
  pct: number;
};

function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/** A successful retry replaces stale failures for the exact same local file. */
export function reconcileCompletedUpload(
  uploads: UploadedFile[],
  id: string,
  result: { ok: boolean; error?: string },
): UploadedFile[] {
  const completed = uploads.find((upload) => upload.id === id);
  return uploads
    .map((upload) => upload.id === id
      ? {
          ...upload,
          status: result.ok ? "success" as const : "error" as const,
          error: result.ok ? undefined : result.error,
          pct: result.ok ? 100 : upload.pct,
        }
      : upload)
    .filter((upload) => !(
      result.ok &&
      completed &&
      upload.id !== id &&
      upload.status === "error" &&
      sameFile(upload.file, completed.file) && upload.checklistKey === completed.checklistKey
    ));
}

let uploadIdCounter = 0;

export function PortalUploadDropzone({ token, onUploadComplete, selectedDocument, onClearSelection }: Props) {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  const runUpload = useCallback(
    async (id: string, file: File, checklistKey: string | null) => {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: "uploading", error: undefined, pct: 0 } : u)),
      );
      try {
        const result = await uploadBorrowerFile(token, file, checklistKey, (pct) => {
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, pct } : u)));
        });
        setUploads((prev) => reconcileCompletedUpload(prev, id, result));
        if (result.ok) onUploadComplete?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: "error", error: message } : u)));
      }
    },
    [token, onUploadComplete],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (selectedDocument && files.length > 1) {
        setSelectionError("Choose one file for the selected document request.");
        return;
      }
      setSelectionError("");

      const newUploads: UploadedFile[] = files.map((f) => ({
        id: `up-${++uploadIdCounter}`,
        file: f,
        name: f.name,
        checklistKey: selectedDocument?.key ?? null,
        status: "uploading",
        pct: 0,
      }));
      setUploads((prev) => [...prev, ...newUploads]);

      for (const u of newUploads) {
        void runUpload(u.id, u.file, u.checklistKey);
      }
    },
    [runUpload, selectedDocument],
  );

  const retryUpload = useCallback(
    (id: string) => {
      const target = uploads.find((u) => u.id === id);
      if (target) void runUpload(id, target.file, target.checklistKey);
    },
    [uploads, runUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    },
    [handleFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const files = Array.from(e.target.files);
      handleFiles(files);
      e.target.value = "";
    },
    [handleFiles],
  );

  const successCount = uploads.filter((u) => u.status === "success").length;
  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const errorUploads = uploads.filter((u) => u.status === "error");

  return (
    <div className="space-y-4">
      {selectedDocument && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-slate-700">
        Uploading for: <strong>{selectedDocument.title}</strong>. Choose one file for this request.
        <button type="button" className="ml-3 underline" onClick={onClearSelection}>Choose a different document</button>
      </div>}
      {selectionError && <p role="alert" className="text-sm text-rose-700">{selectionError}</p>}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all
          ${
            isDragging
              ? "border-brand-blue-500 bg-blue-50"
              : "border-slate-300 bg-slate-50 hover:border-slate-400"
          }
        `}
      >
        {uploadingCount > 0 ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-sm text-slate-600">
              Uploading {uploadingCount} file{uploadingCount > 1 ? "s" : ""}…
            </p>
            {uploads
              .filter((u) => u.status === "uploading")
              .map((u) => (
                <div key={u.id} className="text-left">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate">{u.name}</span>
                    <span className="shrink-0 tabular-nums">{u.pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-brand-blue-500 transition-all duration-300"
                      style={{ width: `${u.pct}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <>
            <div className="text-3xl mb-2 opacity-50">📄</div>
            <p className="text-sm font-medium text-slate-600 mb-1">
              Drop your documents here
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Tax returns, financial statements, bank statements, lease agreements
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="brand-gradient-cta inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium cursor-pointer hover:brightness-110 transition min-h-[44px] focus-within:ring-2 focus-within:ring-brand-blue-500">
                Choose Files
                <input
                  type="file"
                  multiple={!selectedDocument}
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
              {/* Separate from Choose Files (which stays flexible for
                  PDFs/gallery photos) — capture="environment" opens the
                  camera directly for a borrower photographing a paper
                  document on the spot. */}
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium cursor-pointer hover:bg-slate-100 transition min-h-[44px] focus-within:ring-2 focus-within:ring-brand-blue-500">
                Take a Photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          </>
        )}
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {successCount > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
              {successCount} document{successCount > 1 ? "s" : ""} uploaded successfully
            </div>
          )}
          {errorUploads.map((u) => (
            <div
              key={u.id}
              role="alert"
              className="flex items-center justify-between gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-600"
            >
              <span>
                Failed: {u.name} — {u.error}
              </span>
              <button
                type="button"
                onClick={() => retryUpload(u.id)}
                className="shrink-0 min-h-8 rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-1"
              >
                Retry
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <p className="text-xs font-medium text-slate-500 mb-2">
          Common documents to include:
        </p>
        <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
          <span>• 3 years business tax returns</span>
          <span>• Year-to-date P&amp;L</span>
          <span>• Balance sheet</span>
          <span>• Personal tax returns</span>
          <span>• Personal financial statement</span>
          <span>• Bank statements (3 months)</span>
          <span>• Business licenses</span>
          <span>• Lease agreement</span>
        </div>
      </div>
    </div>
  );
}
