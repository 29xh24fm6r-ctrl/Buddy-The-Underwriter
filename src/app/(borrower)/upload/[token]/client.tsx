"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@/components/ui/Icon";
import { useRouter } from "next/navigation";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export function UploadPageClient({ token }: { token: string }) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [done, setDone] = React.useState(false);

  function safeUploadError(input: unknown) {
    const text = typeof input === "string" ? input.toLowerCase() : "";
    if (text.includes("signed") || text.includes("storage") || text.includes("provider")) {
      return "We had trouble reaching the secure upload service. Please try again.";
    }
    return "Buddy could not finish that upload. Please try the file again or use a clearer copy.";
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setProgress(0);
    setErr(null);
    setDone(false);

    try {
      // SPEC-PORTAL-1: the borrower upload path is /api/portal/upload/prepare +
      // /commit (the maintained, token-in-body routes). The prior /upload-init +
      // /upload-complete routes never existed, so every upload here 404'd. Contract
      // mirrors the working consumer in src/app/portal/[token]/ui.tsx.

      // 1. Prepare — get a signed storage URL + upload session
      const prep = await j<{
        signedUrl: string;
        path: string;
        bucket: string;
        uploadSessionId: string;
        fileId: string;
      }>(`/api/portal/upload/prepare`, {
        method: "POST",
        body: JSON.stringify({
          token,
          requestId: null,
          filename: file.name,
          mimeType: file.type,
        }),
      });

      // 2. Upload bytes directly to the secure storage destination from prepare
      const uploadRes = await fetch(prep.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });

      if (!uploadRes.ok) throw new Error("Upload failed");

      setProgress(80);

      // 3. Commit — record the upload and materialize the document
      await j(`/api/portal/upload/commit`, {
        method: "POST",
        headers: prep.uploadSessionId
          ? { "x-buddy-upload-session-id": prep.uploadSessionId }
          : {},
        body: JSON.stringify({
          token,
          path: prep.path,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          uploadSessionId: prep.uploadSessionId,
          fileId: prep.fileId,
        }),
      });

      setProgress(100);
      setDone(true);

      // Redirect to portal
      setTimeout(() => router.push(`/portal/${token}`), 700);
    } catch (e: any) {
      setErr(safeUploadError(e?.message ?? "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  return (
    <div className="brand-hero-bg relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div
        className="brand-glow pointer-events-none absolute -right-24 -top-32 h-[460px] w-[460px] rounded-full"
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-2xl rounded-[2rem] bg-white p-8 text-slate-900 shadow-[0_24px_70px_rgba(0,0,0,0.35)]"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="brand-gradient-cta flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
            <Icon name="cloud_upload" className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-slate-900">Add the documents Buddy requested</h1>
            <p className="mt-1 text-sm text-slate-600">
              Clear PDFs, scans, spreadsheets, and phone photos are all acceptable for this secure SBA portal.
            </p>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`rounded-[1.5rem] border-2 border-dashed p-12 text-center transition-colors ${
            dragActive
              ? "border-brand-blue-500 bg-brand-blue-500/5"
              : "border-slate-300 bg-slate-50/50"
          }`}
        >
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <Icon name="check_circle" className="h-8 w-8 text-emerald-600" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Got it — taking you back to your portal…</p>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <motion.div
                  animate={dragActive ? { y: -4 } : { y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <Icon
                    name="description"
                    className={`mx-auto mb-4 h-12 w-12 ${dragActive ? "text-brand-blue-500" : "text-slate-400"}`}
                  />
                </motion.div>
                <label
                  htmlFor="file-upload"
                  className="brand-gradient-cta inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2"
                >
                  <Icon name="add" className="h-5 w-5 text-white" />
                  Choose a document
                </label>
                <input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
                <p className="mt-3 text-xs text-slate-500">
                  or drag a file in here — PDF, Excel, Word, or images (max 50MB)
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {uploading && (
            <div className="mt-6">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div
                  className="h-2 rounded-full bg-gradient-to-r from-[#1c8de0] to-[#4db8f0]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "easeOut" }}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {progress < 100 ? `Uploading... ${progress}%` : "Buddy is reviewing this file"}
              </p>
            </div>
          )}

          {err && (
            <div className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-900">
              <div className="font-semibold">Needs another file</div>
              <div className="mt-1 text-xs">{err}</div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push(`/portal/${token}`)}
            className="text-sm font-medium text-slate-600 hover:text-brand-blue-500"
          >
            ← Back to Portal
          </button>
          <p className="text-xs text-slate-500">
            Secure SBA document portal. Files encrypted in transit. Only your SBA team can access these documents.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
