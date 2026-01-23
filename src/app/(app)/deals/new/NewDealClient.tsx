"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadViaSignedUrl } from "@/lib/uploads/uploadFile";
import { markUploadsCompletedAction } from "./actions";
import { CHECKLIST_KEY_OPTIONS } from "@/lib/checklist/checklistKeyOptions";

type SelectedFile = {
  id: string;
  file: File;
  checklistKey: string; // empty = unclassified
};

type UploadSessionResponse = {
  ok: boolean;
  dealId?: string;
  uploads?: Array<{
    filename: string;
    objectKey: string;
    uploadUrl: string;
    headers: Record<string, string>;
    fileId: string;
    checklistKey?: string | null;
    bucket: string;
  }>;
  error?: string;
  details?: string;
  requestId?: string;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function requestId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function NewDealClient({
  bankId,
  initialDealName,
}: {
  bankId: string;
  initialDealName: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dealName, setDealName] = useState(initialDealName || "");
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [debugInfo, setDebugInfo] = useState<{ requestId: string | null; stage: string | null }>(
    { requestId: null, stage: null },
  );
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleFiles = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const fileArray = Array.from(selectedFiles);
    setFiles((prev) => [
      ...prev,
      ...fileArray.map((file) => ({
        id: uid(),
        file,
        checklistKey: "",
      })),
    ]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProcessing(false);
    setProcessError(null);
    setUploadProgress({ current: 0, total: files.length });

    const classifyNetworkError = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      const name = (e as any)?.name;
      const isAbort = name === "AbortError";
      const isNetwork = msg === "Failed to fetch" || msg.toLowerCase().includes("networkerror");
      return { msg, name, isAbort, isNetwork };
    };

    const createUploadSession = async () => {
      const ac = new AbortController();
      const rid = requestId();
      const t = setTimeout(() => ac.abort(), 20000);
      try {
        const createRes = await fetch("/api/deals/new/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-request-id": rid },
          signal: ac.signal,
          body: JSON.stringify({
            dealName: dealName || `Deal - ${new Date().toLocaleDateString()}`,
            files: files.map((f) => ({
              filename: f.file.name,
              contentType: f.file.type,
              sizeBytes: f.file.size,
              checklistKey: f.checklistKey || null,
            })),
          }),
        });

        const payload = (await createRes.json().catch(() => null)) as UploadSessionResponse | null;
        if (!createRes.ok || !payload?.ok) {
          const errText = payload?.error || `Failed to create upload session (${createRes.status})`;
          throw new Error(errText);
        }

        if (!payload?.dealId || !payload?.uploads?.length) {
          throw new Error("failed_to_create_upload_session");
        }

        return { dealId: payload.dealId, uploads: payload.uploads, requestId: rid };
      } finally {
        clearTimeout(t);
      }
    };

    const createUploadSessionWithRetries = async () => {
      const maxAttempts = 3;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await createUploadSession();
        } catch (e) {
          lastErr = e;
          const { isAbort, isNetwork } = classifyNetworkError(e);
          const msg = e instanceof Error ? e.message : String(e);
          const retryableStatus = msg.startsWith("timeout:") || msg.includes("504") || msg.includes("502") || msg.includes("503");
          const shouldRetry = attempt < maxAttempts && (isAbort || isNetwork || retryableStatus);
          if (!shouldRetry) break;
          await new Promise((r) => setTimeout(r, 350 * attempt));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    };

    const pollIntakeStatus = async (dealId: string) => {
      const maxAttempts = 30;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const res = await fetch(`/api/deals/${dealId}/intake/status`, { cache: "no-store" });
          if (res.status === 404) {
            // Transient during creation/replication.
            continue;
          }
          const json = await res.json().catch(() => ({}));
          if (res.status === 401) {
            return { ok: false, error: "Unauthorized" };
          }
          if (!res.ok || json?.ok === false) {
            if (res.status >= 500) {
              continue;
            }
            return { ok: false, error: json?.error || `HTTP ${res.status}` };
          }
          const stage = String(json?.stage || "");
          const recommended = json?.recommendedNextAction ?? null;
          if (stage === "complete" || stage === "ready" || stage === "underwriting" || !recommended) {
            return { ok: true, status: "ready" };
          }
        } catch {
          // ignore transient polling errors
        }
      }
      return { ok: true, status: "timeout" };
    };

    try {
      // 1. Create deal + upload session
      setDebugInfo({ requestId: null, stage: "create_upload_session" });
      const session = await createUploadSessionWithRetries();
      const dealId = session.dealId;
      const createdName = dealName;
      console.log(`Created deal ${dealId} (request ${session.requestId}), uploading ${files.length} files...`);

      // 2. Upload files to the deal
      setUploadProgress({ current: 0, total: files.length });
      let successCount = 0;
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const file = item.file;
        const rid = requestId();
        setDebugInfo({ requestId: rid, stage: "starting_file" });
        setUploadProgress({ current: i + 1, total: files.length });
        const uploadSpec = session.uploads[i];
        if (!uploadSpec) {
          throw new Error("upload_session_mismatch");
        }

        setDebugInfo({ requestId: rid, stage: "upload_put" });
        const uploadRes = await uploadViaSignedUrl(uploadSpec.uploadUrl, file);
        if (!uploadRes.ok) {
          const message = `Upload failed: ${uploadRes.error || "Unknown error"}`;
          setProcessError(message);
          throw new Error(message);
        }

        setDebugInfo({ requestId: rid, stage: "record_file" });
        const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-request-id": rid },
          body: JSON.stringify({
            file_id: uploadSpec.fileId,
            object_path: uploadSpec.objectKey,
            original_filename: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            checklist_key: item.checklistKey || null,
            storage_bucket: uploadSpec.bucket,
          }),
        });

        if (!recordRes.ok) {
          const errJson = await recordRes.json().catch(() => null as any);
          const errText = errJson?.error || `Record failed (${recordRes.status})`;
          throw new Error(errText);
        }

        successCount++;
      }

      console.log(`Uploaded ${successCount}/${files.length} files to deal ${dealId}`);

      // 🔥 CRITICAL: Mark upload batch as complete to unblock auto-seed
      if (successCount > 0) {
        try {
          // Best-effort only. On some Vercel previews, Node-backed endpoints can hang;
          // never block redirect on this.
          await Promise.race([
            markUploadsCompletedAction(dealId, bankId),
            new Promise<void>((_resolve, reject) =>
              setTimeout(() => reject(new Error("markUploadsCompletedAction_timeout")), 3000),
            ),
          ]);
          console.log(`✅ Marked uploads completed for deal ${dealId}`);
        } catch (e) {
          // Best-effort only: do not block redirect to cockpit.
          console.error("markUploadsCompletedAction failed (ignored):", e);
        }
      }

      // 3. Trigger intake orchestration
      setProcessing(true);
      setDebugInfo({ requestId: null, stage: "intake_run" });
      const runRes = await fetch(`/api/deals/${dealId}/intake/run`, { method: "POST" });
      const runJson = await runRes.json().catch(() => ({}));
      if (!runRes.ok || runJson?.ok === false) {
        throw new Error(`Intake run failed (${runRes.status}): ${runJson?.error || "unknown"}`);
      }

      // 4. Optional: poll intake status for a short window
      setDebugInfo({ requestId: null, stage: "intake_poll" });
      const pollResult = await pollIntakeStatus(dealId);
      if (!pollResult.ok) {
        throw new Error(`Intake status error: ${pollResult.error || "unknown"}`);
      }

      // 5. Redirect to the deal cockpit (command center)
      router.push(
        `/deals/${dealId}/cockpit${createdName ? `?n=${encodeURIComponent(createdName)}` : ""}`,
      );
    } catch (error) {
      console.error("Upload failed:", error);

      const { isAbort, isNetwork, msg } = classifyNetworkError(error);
      if (isAbort) {
        setProcessError(
          "Create deal timed out (20s). This is usually a cold-start/serverless stall. Retry once; if it keeps happening, share the Request ID + Stage shown during upload.",
        );
        return;
      }
      if (isNetwork) {
        setProcessError(
          "Network error calling the backend. Retry once; if it keeps happening, share the Request ID + Stage shown during upload.",
        );
        return;
      }
      setProcessError(msg || "Upload failed");
    } finally {
      setUploading(false);
      setProcessing(false);
      setDebugInfo({ requestId: null, stage: null });
    }
  }, [files, dealName, bankId, router]);

  return (
    <div className="h-full flex flex-col bg-[#0a0d12]">
      {/* Header */}
      <div className="border-b border-gray-800 px-8 py-6 bg-[#0f1318]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">New Deal Intake</h1>
            <p className="text-sm text-gray-400">
              Upload documents to start a new deal package
            </p>
          </div>
          <Link
            href="/deals"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          {/* Deal Name Input */}
          <div className="mb-8">
            <label htmlFor="dealName" className="block text-sm font-medium text-gray-300 mb-2">
              Deal Name
            </label>
            <input
              id="dealName"
              type="text"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              placeholder="Enter deal name..."
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative border-2 border-dashed rounded-xl p-12 mb-8 transition-all
              ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 bg-gray-800/30 hover:border-gray-600 hover:bg-gray-800/50"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
              accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
            />

            <div className="flex flex-col items-center text-center">
              <div className="mb-4 p-4 rounded-full bg-blue-500/20 text-blue-400">
                <span className="material-symbols-outlined text-[48px]">
                  cloud_upload
                </span>
              </div>

              <h3 className="text-xl font-semibold text-white mb-2">
                {isDragging ? "Drop files here" : "Drag & Drop Deal Package"}
              </h3>

              <p className="text-sm text-gray-400 mb-6 max-w-md">
                Upload financial statements, tax returns, business documents, and any
                other supporting materials
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleBrowseClick}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  Browse Files
                </button>
                <button className="px-6 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 font-medium rounded-lg transition-colors">
                  Import from Deal Room
                </button>
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Supported: PDF, Excel, Word, Images • Max 500MB per file
              </p>
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Selected Files ({files.length})
                </h3>
                <button
                  onClick={() => setFiles([])}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-2">
                {files.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="material-symbols-outlined text-gray-400">
                        description
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{it.file.name}</p>
                        <p className="text-xs text-gray-400">
                          {(it.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>

                    <div className="ml-4 flex items-center gap-2">
                      <label className="text-xs text-gray-400">Checklist</label>
                      <select
                        className="rounded-lg border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
                        value={it.checklistKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFiles((prev) =>
                            prev.map((x) => (x.id === it.id ? { ...x, checklistKey: v } : x))
                          );
                        }}
                        disabled={uploading}
                        title="Optional: attach this file to a checklist item"
                      >
                        <option value="">Unclassified</option>
                        {CHECKLIST_KEY_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {opt.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => removeFile(it.id)}
                      className="ml-4 p-1 text-gray-400 hover:text-red-400 transition-colors"
                      disabled={uploading}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        close
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {files.length > 0 && (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setFiles([])}
                disabled={uploading || processing}
                className="px-6 py-3 text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || processing}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {uploading || processing ? (
                  <>
                    {uploading ? `${uploadProgress.current}/${uploadProgress.total}` : "Processing"}
                    <span className="animate-spin material-symbols-outlined text-[20px]">
                      progress_activity
                    </span>
                    {uploading ? "Uploading..." : "Processing..."}
                    {debugInfo.requestId ? (
                      <span className="ml-2 text-xs text-white/80">
                        (Request: {debugInfo.requestId}{debugInfo.stage ? ` • ${debugInfo.stage}` : ""})
                      </span>
                    ) : debugInfo.stage ? (
                      <span className="ml-2 text-xs text-white/80">({debugInfo.stage})</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">
                      upload
                    </span>
                    Start Deal Processing
                  </>
                )}
              </button>
            </div>
          )}

          {processError ? (
            <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {processError}
            </div>
          ) : null}

          {/* Help Text */}
          <div className="mt-8 p-6 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <div className="flex gap-4">
              <span className="material-symbols-outlined text-blue-400 flex-shrink-0">
                info
              </span>
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">
                  What happens next?
                </h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>
                    • Documents will be automatically classified and extracted
                  </li>
                  <li>• Financial data will be parsed and analyzed</li>
                  <li>• Conditions and requirements will be generated</li>
                  <li>
                    • You'll be notified when the deal is ready for review
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
