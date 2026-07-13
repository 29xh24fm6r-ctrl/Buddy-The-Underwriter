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
};

type UploadedFile = {
  name: string;
  status: "uploading" | "success" | "error";
  error?: string;
};

export function PortalUploadDropzone({ token, onUploadComplete }: Props) {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const newUploads: UploadedFile[] = files.map((f) => ({
        name: f.name,
        status: "uploading",
      }));
      setUploads((prev) => [...prev, ...newUploads]);

      for (const file of files) {
        try {
          const result = await uploadBorrowerFile(token, file, null);
          setUploads((prev) =>
            prev.map((u) =>
              u.name === file.name && u.status === "uploading"
                ? {
                    ...u,
                    status: result.ok ? "success" : "error",
                    error: result.ok ? undefined : result.error,
                  }
                : u,
            ),
          );
          if (result.ok) onUploadComplete?.();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setUploads((prev) =>
            prev.map((u) =>
              u.name === file.name && u.status === "uploading"
                ? { ...u, status: "error", error: message }
                : u,
            ),
          );
        }
      }
    },
    [token, onUploadComplete],
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
          <div className="space-y-2">
            <div className="inline-block w-6 h-6 border-2 border-brand-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-600">
              Uploading {uploadingCount} file{uploadingCount > 1 ? "s" : ""}…
            </p>
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
            <label className="brand-gradient-cta inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium cursor-pointer hover:brightness-110 transition min-h-[44px] focus-within:ring-2 focus-within:ring-brand-blue-500">
              Choose Files
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </>
        )}
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {successCount > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
              {successCount} document{successCount > 1 ? "s" : ""} uploaded successfully
            </div>
          )}
          {errorUploads.map((u, i) => (
            <div
              key={`err-${i}-${u.name}`}
              className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-600"
            >
              Failed: {u.name} — {u.error}
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
