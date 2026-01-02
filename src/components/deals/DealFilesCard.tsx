"use client";

import { useEffect, useState } from "react";

type DealFile = {
  file_id: string;
  deal_id: string;
  original_name: string;
  stored_name?: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string | null;
  checklist_key: string | null;
  source: string | null;
  created_at: string;
};

export default function DealFilesCard({ dealId }: { dealId: string }) {
  const [files, setFiles] = useState<DealFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DealFile | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const canPreview = (mime: string | null) => {
    if (!mime) return false;
    return mime.startsWith("image/") || mime === "application/pdf";
  };

  async function loadFiles() {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/files/list`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json?.ok && json.files) {
        setFiles(json.files);
      }
    } catch (error) {
      console.error("[DealFilesCard] Failed to load files:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles();
    const interval = setInterval(loadFiles, 10000);
    return () => clearInterval(interval);
  }, [dealId]);

  async function handleAutoMatch() {
    setMatching(true);
    setMatchResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/files/auto-match-checklist`, {
        method: "POST",
      });
      const json = await res.json();
      if (json?.ok) {
        setMatchResult(
          `✅ Matched ${json.totalUpdated} checklist items from ${json.filesProcessed} files`,
        );
        await loadFiles();
      } else {
        setMatchResult(`⚠️ ${json?.error || "Failed to match"}`);
      }
    } catch (error: any) {
      setMatchResult(`❌ ${error?.message || "Unknown error"}`);
    } finally {
      setMatching(false);
    }
  }

  async function handleDownload(file: DealFile) {
    const res = await fetch(
      `/api/deals/${dealId}/files/signed-url?fileId=${file.file_id}`,
    );
    const json = await res.json();
    if (!json?.ok || !json.signedUrl) {
      alert("Failed to create signed URL");
      return;
    }
    window.open(json.signedUrl, "_blank");
  }

  async function handlePreview(file: DealFile) {
    setLoadingPreview(true);
    const res = await fetch(
      `/api/deals/${dealId}/files/signed-url?fileId=${file.file_id}`,
    );
    const json = await res.json();
    setLoadingPreview(false);

    if (!json?.ok || !json.signedUrl) {
      alert("Failed to create signed URL");
      return;
    }

    setPreviewUrl(json.signedUrl);
    setPreviewFile(file);
  }

  function closePreview() {
    setPreviewUrl(null);
    setPreviewFile(null);
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="text-base font-semibold text-neutral-50">Deal Files</div>
        <div className="mt-3 flex items-center gap-2 text-sm text-neutral-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
          Loading files…
        </div>
      </div>
    );
  }

  const showPreview = Boolean(previewUrl && previewFile);

  return (
    <>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-base font-semibold text-neutral-50">
              Deal Files ({files.length})
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              {files.length === 0
                ? "No documents uploaded yet. Upload files on the New Deal page before navigating here."
                : "Files uploaded to this deal. Click 'Auto-Match' to link them to checklist items."}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadFiles}
              disabled={loading}
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              title="Refresh file list"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={handleAutoMatch}
              disabled={matching || files.length === 0}
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              {matching ? "Matching..." : "Auto-Match"}
            </button>
          </div>
        </div>

        {matchResult && (
          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm text-neutral-200">
            {matchResult}
          </div>
        )}

        {files.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-neutral-700 bg-neutral-900/20 p-8 text-center">
            <div className="text-lg mb-2">📁</div>
            <div className="text-sm font-medium text-neutral-300 mb-1">
              No files uploaded yet
            </div>
            <div className="text-xs text-neutral-500">
              Upload documents on the "New Deal" page, then they'll appear here
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.file_id}
                className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">
                      {file.original_name}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {file.checklist_key
                        ? `🔗 ${file.checklist_key}`
                        : "No checklist match"} • {(file.size_bytes / 1024).toFixed(1)} KB
                    </div>
                    <div className="text-xs text-neutral-500">
                      {file.source || "Unknown source"} • {new Date(file.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {canPreview(file.mime_type) && (
                      <button
                        type="button"
                        onClick={() => handlePreview(file)}
                        disabled={loadingPreview}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {loadingPreview ? "..." : "Preview"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDownload(file)}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closePreview}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full mx-4 bg-neutral-900 rounded-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-4 bg-neutral-900 border-b border-neutral-800">
              <div className="text-base font-semibold text-neutral-50 truncate">
                {previewFile!.original_name}
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Close
              </button>
            </div>

            <div className="p-4">
              {previewFile!.mime_type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl!}
                  alt={previewFile!.original_name}
                  className="w-full h-auto"
                />
              ) : previewFile!.mime_type === "application/pdf" ? (
                <iframe
                  src={previewUrl!}
                  className="w-full h-[70vh] border-0"
                  title={previewFile!.original_name}
                />
              ) : (
                <p className="text-sm text-neutral-400">Preview not available</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
