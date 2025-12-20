"use client";

import { useState, useEffect } from "react";

type DealFile = {
  id: string;
  deal_id: string;
  file_name: string;
  file_storage_path: string;
  file_size_bytes: number;
  mime_type: string | null;
  checklist_key: string | null;
  uploaded_by_email: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  ocr_status: string | null;
  classify_status: string | null;
};

export default function DealFilesCard({ dealId }: { dealId: string }) {
  const [files, setFiles] = useState<DealFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DealFile | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/files/list`);
      const json = await res.json();
      if (json?.ok && json.files) setFiles(json.files);
      setLoading(false);
    }
    load();
  }, [dealId]);

  async function handleDownload(file: DealFile) {
    const res = await fetch(`/api/deals/${dealId}/files/signed-url?fileId=${file.id}`);
    const json = await res.json();
    if (!json?.ok || !json.signedUrl) {
      alert("Failed to create signed URL");
      return;
    }
    window.open(json.signedUrl, "_blank");
  }

  async function handlePreview(file: DealFile) {
    setLoadingPreview(true);
    const res = await fetch(`/api/deals/${dealId}/files/signed-url?fileId=${file.id}`);
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
        <div className="mt-2 text-sm text-neutral-400">Loading...</div>
      </div>
    );
  }

  const canPreview = (mime: string | null) => {
    if (!mime) return false;
    return mime.startsWith("image/") || mime === "application/pdf";
  };

  return (
    <>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-sm">
        <div className="text-base font-semibold text-neutral-50">Deal Files ({files.length})</div>

        {files.length === 0 ? (
          <div className="mt-2 text-sm text-neutral-400">No files uploaded yet</div>
        ) : (
          <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
            {files.map((file) => (
              <div key={file.id} className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">{file.file_name}</div>
                    <div className="text-xs text-neutral-500">
                      {file.checklist_key || "No key"} • {(file.file_size_bytes / 1024).toFixed(1)} KB
                    </div>
                    <div className="text-xs text-neutral-500">
                      {file.uploaded_by_name || file.uploaded_by_email || "Unknown"} •{" "}
                      {new Date(file.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canPreview(file.mime_type) && (
                      <button
                        onClick={() => handlePreview(file)}
                        disabled={loadingPreview}
                        className="rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {loadingPreview ? "..." : "Preview"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(file)}
                      className="rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                    >
                      Download
                    </button>
                  </div>
                </div>

                {(file.ocr_status || file.classify_status) && (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    {file.ocr_status && <span>OCR: {file.ocr_status}</span>}
                    {file.classify_status && <span>Classify: {file.classify_status}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {previewUrl && previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closePreview}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full mx-4 bg-neutral-900 rounded-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-4 bg-neutral-900 border-b border-neutral-800">
              <div className="text-base font-semibold text-neutral-50 truncate">{previewFile.file_name}</div>
              <button
                onClick={closePreview}
                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Close
              </button>
            </div>

            <div className="p-4">
              {previewFile.mime_type?.startsWith("image/") ? (
                <img src={previewUrl} alt={previewFile.file_name} className="w-full h-auto" />
              ) : previewFile.mime_type === "application/pdf" ? (
                <iframe src={previewUrl} className="w-full h-[70vh] border-0" title={previewFile.file_name} />
              ) : (
                <p className="text-sm text-neutral-400">Preview not available</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
