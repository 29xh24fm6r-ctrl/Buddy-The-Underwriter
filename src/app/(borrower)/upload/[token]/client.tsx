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

      // 2. Upload to signed URL
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
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full rounded-2xl bg-white text-neutral-900 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Icon name="cloud_upload" className="h-8 w-8" />
          <div>
            <h1 className="text-2xl font-semibold">Upload Your Documents</h1>
            <p className="text-sm text-neutral-600 mt-1">
              Upload financial statements, tax returns, or other requested documents.
            </p>
          </div>
        </div>

        <div className="rounded-xl border-2 border-dashed border-neutral-300 p-12 text-center">
          <Icon name="description" className="h-12 w-12 mx-auto text-neutral-400 mb-4" />
          <label
            htmlFor="file-upload"
            className="cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            <Icon name="add" className="h-5 w-5 text-white" />
            Select File
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
              <p className="mt-2 text-sm text-neutral-600">Uploading… {progress}%</p>
            </div>
          )}

          {err && (
            <div className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-900">
              <div className="font-semibold">Upload failed</div>
              <div className="mt-1 text-xs">{err}</div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between items-center">
          <button
            type="button"
            onClick={() => router.push(`/portal/${token}`)}
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            ← Back to Portal
          </button>
          <p className="text-xs text-neutral-500">Your data is encrypted and secure.</p>
        </div>
      </div>
    </div>
  );
}
