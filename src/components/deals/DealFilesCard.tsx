"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CHECKLIST_KEY_OPTIONS } from "@/lib/checklist/checklistKeyOptions";
import { useShouldPoll } from "@/buddy/cockpit";

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
  const { shouldPoll } = useShouldPoll();
  const [files, setFiles] = useState<DealFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [checklistOptions, setChecklistOptions] = useState<
    Array<{ key: string; title: string }>
  >([]);
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DealFile | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const canPreview = (mime: string | null) => {
    if (!mime) return false;
    return mime.startsWith("image/") || mime === "application/pdf";
  };

  async function fetchJsonWithTimeout(url: string, ms: number, init?: RequestInit) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ac.signal, ...init });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    } finally {
      clearTimeout(t);
    }
  }

  async function loadFiles(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const { res, json } = await fetchJsonWithTimeout(`/api/deals/${dealId}/files/list`, 15_000);
      if (res.ok && json?.ok && json.files) setFiles(json.files);

      // Best-effort: load the actual seeded checklist so the dropdown shows the deal's real items.
      const clOut = await fetchJsonWithTimeout(`/api/deals/${dealId}/checklist/list`, 15_000).catch(
        () => null as any,
      );
      const clJson = clOut?.json ?? {};
      if (clJson?.ok && Array.isArray(clJson.items)) {
        const opts = (clJson.items as any[])
          .map((it) => ({
            key: String(it.checklist_key),
            title: String(it.title || it.checklist_key),
          }))
          .filter((x) => x.key);

        // De-dupe while preserving seeded order.
        const seen = new Set<string>();
        const unique = [] as Array<{ key: string; title: string }>;
        for (const o of opts) {
          if (seen.has(o.key)) continue;
          seen.add(o.key);
          unique.push(o);
        }
        setChecklistOptions(unique);
      } else if (checklistOptions.length === 0) {
        // Fallback only if we haven't already loaded something.
        setChecklistOptions(CHECKLIST_KEY_OPTIONS);
      }
    } catch (error) {
      console.error("[DealFilesCard] Failed to load files:", error);
      if (checklistOptions.length === 0) setChecklistOptions(CHECKLIST_KEY_OPTIONS);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  async function setChecklistKey(file: DealFile, checklistKey: string | null) {
    const id = file.file_id;
    setSavingById((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(
        `/api/deals/${dealId}/documents/${encodeURIComponent(id)}/checklist-key`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checklist_key: checklistKey }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        alert(json?.error || "Failed to update checklist key");
        return;
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.file_id === id ? { ...f, checklist_key: json.checklist_key ?? null } : f,
        ),
      );
    } finally {
      setSavingById((prev) => ({ ...prev, [id]: false }));
    }
  }

  useEffect(() => {
    loadFiles();

    // Only poll when cockpit says we should (deal is busy)
    if (!shouldPoll) return;

    const interval = setInterval(() => {
      void loadFiles({ silent: true });
    }, 5000); // 5s when busy
    return () => clearInterval(interval);
  }, [dealId, shouldPoll]);

  async function handleAutoMatch() {
    setMatching(true);
    setMatchResult(null);
    try {
      const { res, json } = await fetchJsonWithTimeout(
        `/api/deals/${dealId}/files/auto-match-checklist`,
        30_000,
        { method: "POST" },
      );
      if (json?.ok) {
        const totalMatched = Number(json?.totalMatched || 0);
        const filesLinked = Number(json?.filesLinked || 0);
        const totalUpdated = Number(json?.totalUpdated || 0);

        if (totalMatched === 0 && filesLinked === 0 && totalUpdated === 0) {
          setMatchResult(
            `ℹ️ Auto-Match found 0 confident matches (from ${json.filesProcessed} files). ` +
              `Borrower filenames are unreliable — run 'AI Doc Recognition' to classify documents by content, ` +
              `then click Auto-Match again.`,
          );
        } else {
          setMatchResult(
            `✅ Auto-Match: ${totalMatched} matches, ${filesLinked} files linked, ${totalUpdated} checklist items marked received (from ${json.filesProcessed} files)`,
          );
        }
        await loadFiles({ silent: true });
      } else {
        setMatchResult(`⚠️ ${json?.error || (!res.ok ? `HTTP ${res.status}` : "Failed to match")}`);
      }
    } catch (error: any) {
      setMatchResult(
        `❌ ${error?.name === "AbortError" ? "Auto-match timed out" : error?.message || "Unknown error"}`,
      );
    } finally {
      setMatching(false);
    }
  }

  async function handleDownload(file: DealFile) {
    const { res, json } = await fetchJsonWithTimeout(
      `/api/deals/${dealId}/files/signed-url?fileId=${encodeURIComponent(file.file_id)}`,
      15_000,
    );
    if (!res.ok || !json?.ok || !json.signedUrl) {
      alert(json?.error || "Failed to create signed URL");
      return;
    }

    // Use an anchor click to reduce popup-blocking issues.
    const a = document.createElement("a");
    a.href = String(json.signedUrl);
    a.target = "_blank";
    a.rel = "noreferrer";
    a.click();
  }

  async function handlePreview(file: DealFile) {
    setLoadingPreview(true);
    try {
      const { res, json } = await fetchJsonWithTimeout(
        `/api/deals/${dealId}/files/signed-url?fileId=${encodeURIComponent(file.file_id)}`,
        15_000,
      );

      if (!res.ok || !json?.ok || !json.signedUrl) {
        alert(json?.error || "Failed to create signed URL");
        return;
      }

      setPreviewUrl(String(json.signedUrl));
      setPreviewFile(file);
    } catch (e: any) {
      alert(e?.name === "AbortError" ? "Preview timed out" : e?.message || "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
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
              onClick={() => void loadFiles({ silent: true })}
              disabled={loading || refreshing}
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              title="Refresh file list"
            >
              {refreshing ? "…" : "↻"}
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
                      <Link
                        href={`/deals/${dealId}/documents/${file.file_id}`}
                        className="hover:underline"
                      >
                        {file.original_name}
                      </Link>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {file.checklist_key
                        ? `🔗 ${file.checklist_key}`
                        : "No checklist match"} • {(file.size_bytes / 1024).toFixed(1)} KB
                    </div>
                    <div className="text-xs text-neutral-500">
                      {file.source || "Unknown source"} • {new Date(file.created_at).toLocaleDateString()}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-neutral-400">Checklist</label>
                      <select
                        className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        value={file.checklist_key ?? ""}
                        onChange={(e) =>
                          void setChecklistKey(
                            file,
                            e.target.value ? e.target.value : null,
                          )
                        }
                        disabled={!!savingById[file.file_id]}
                        title="Manually attach this file to a checklist item"
                      >
                        <option value="">Unclassified</option>
                        {(checklistOptions.length ? checklistOptions : CHECKLIST_KEY_OPTIONS).map(
                          (opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.title}
                            </option>
                          ),
                        )}
                      </select>
                      {savingById[file.file_id] ? (
                        <span className="text-xs text-neutral-500">Saving…</span>
                      ) : null}
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
