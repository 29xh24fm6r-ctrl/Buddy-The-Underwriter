"use client";

import * as React from "react";
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

  function safeUploadError(input: unknown) {
    const text = typeof input === "string" ? input.toLowerCase() : "";
    if (text.includes("signed") || text.includes("storage") || text.includes("provider")) {
      return "We had trouble reaching the secure upload service. Please try again.";
    }
    return "Buddy could not finish that upload. Please try the file again or use a clearer copy.";
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setErr(null);

    try {
      // 1. Init upload
      const { upload_url, upload_id } = await j<{ upload_url: string; upload_id: string; path: string }>(
        `/api/portal/${token}/upload-init`,
        {
          method: "POST",
          body: JSON.stringify({ filename: file.name, size: file.size, mime_type: file.type }),
        }
      );

      // 2. Upload to the secure destination returned by the portal
      const uploadRes = await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });

      if (!uploadRes.ok) throw new Error("Upload failed");

      setProgress(80);

      // 3. Mark complete
      await j(`/api/portal/${token}/upload-complete`, {
        method: "POST",
        body: JSON.stringify({ upload_id }),
      });

      setProgress(100);

      // Redirect to portal
      setTimeout(() => router.push(`/portal/${token}`), 500);
    } catch (e: any) {
      setErr(safeUploadError(e?.message ?? "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_28%),linear-gradient(180deg,_#fffdf8_0%,_#fffaf0_45%,_#f8fafc_100%)] p-4">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/70 bg-white/92 p-8 text-neutral-900 shadow-[0_22px_70px_rgba(120,53,15,0.10)]">
        <div className="mb-6 flex items-center gap-3">
          <Icon name="cloud_upload" className="h-8 w-8" />
          <div>
            <h1 className="text-2xl font-semibold">Add the documents Buddy requested</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Clear PDFs, scans, spreadsheets, and phone photos are all acceptable for this secure SBA portal.
            </p>
          </div>
        </div>

        <div className="rounded-[1.5rem] border-2 border-dashed border-neutral-300 p-12 text-center">
          <Icon name="description" className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
          <label
            htmlFor="file-upload"
            className="cursor-pointer inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
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
          <p className="mt-3 text-xs text-neutral-500">PDF, Excel, Word, or images (Max 50MB)</p>

          {uploading && (
            <div className="mt-6">
              <div className="h-2 w-full rounded-full bg-neutral-100">
              <div
                  className="h-2 rounded-full bg-neutral-900 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-neutral-600">
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
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            ← Back to Portal
          </button>
          <p className="text-xs text-neutral-500">
            Secure SBA document portal. Files encrypted in transit. Only your SBA team can access these documents.
          </p>
        </div>
      </div>
    </div>
  );
}
