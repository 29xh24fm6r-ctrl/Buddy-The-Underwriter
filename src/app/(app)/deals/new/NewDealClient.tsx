"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadFileWithSignedUrl } from "@/lib/uploads/uploadFile";
import { createUploadSession } from "@/lib/api/uploads";
import { markUploadsCompletedAction } from "./actions";
import { computeTaxYears } from "@/lib/intake/slots/taxYears";
import { CHECKLIST_KEY_OPTIONS } from "@/lib/checklist/checklistKeyOptions";
import { IntakeReviewTable } from "@/components/deals/intake/IntakeReviewTable";

type DealMode = "staging" | "classifying" | "review" | "submitting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectedFile = {
  id: string;
  file: File;
  checklistKey: string; // empty = unclassified
};

type SlotAttachResult = {
  requested: boolean;
  used: "slot_id" | "slot_key" | null;
  slot_key: string | null;
  slot_id: string | null;
  resolved_slot_id: string | null;
  attached: boolean;
  reason: string | null;
};

type UploadOutcome = {
  status: "pending" | "uploading" | "recorded" | "error";
  error?: string | null;
  slotAttach?: SlotAttachResult | null;
};

type SlotGroup = {
  label: string;
  slots: { key: string; label: string }[];
};

type UploadSpec = {
  fileId: string;
  signedUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  objectKey: string;
  bucket: string;
  filename: string;
  sizeBytes: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function requestId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// SlotCard — individual upload target for a core document
// ---------------------------------------------------------------------------

function SlotCard({
  slotKey,
  label,
  file,
  outcome,
  disabled,
  onFileSelect,
  onRemove,
}: {
  slotKey: string;
  label: string;
  file: File | undefined;
  outcome: UploadOutcome | undefined;
  disabled: boolean;
  onFileSelect: (slotKey: string, file: File) => void;
  onRemove: (slotKey: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) return;
      const f = e.dataTransfer.files?.[0];
      if (f) onFileSelect(slotKey, f);
    },
    [slotKey, disabled, onFileSelect],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  // Attachment badge
  const badge = (() => {
    if (!outcome) return null;
    if (outcome.status === "uploading") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-300">
          <span className="animate-spin material-symbols-outlined text-[14px]">progress_activity</span>
          Uploading
        </span>
      );
    }
    if (outcome.status === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-rose-300" title={outcome.error ?? undefined}>
          <span className="material-symbols-outlined text-[14px]">error</span>
          Error
        </span>
      );
    }
    if (outcome.status === "recorded" && outcome.slotAttach) {
      if (outcome.slotAttach.attached) {
        return (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            Attached
          </span>
        );
      }
      if (outcome.slotAttach.requested && !outcome.slotAttach.attached) {
        return (
          <span
            className="inline-flex items-center gap-1 text-xs text-amber-300"
            title={outcome.slotAttach.reason ?? "Unknown reason"}
          >
            <span className="material-symbols-outlined text-[14px]">warning</span>
            Not attached
          </span>
        );
      }
    }
    return null;
  })();

  // Empty state
  if (!file) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center p-4 rounded-lg border-2 border-dashed
          transition-all min-h-[120px] cursor-pointer
          ${dragOver ? "border-blue-500 bg-blue-500/10" : "border-gray-700 bg-gray-800/20 hover:border-gray-500 hover:bg-gray-800/40"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelect(slotKey, f);
            e.target.value = "";
          }}
          disabled={disabled}
        />
        <span className="material-symbols-outlined text-[28px] text-gray-500 mb-1">upload_file</span>
        <span className="text-xs text-gray-400 text-center leading-tight">{label}</span>
        <span className="text-[10px] text-gray-600 mt-1">Browse or drop</span>
      </div>
    );
  }

  // Filled state
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        flex flex-col p-3 rounded-lg border-2 transition-all min-h-[120px]
        ${dragOver ? "border-blue-500 bg-blue-500/10" : "border-emerald-600/60 bg-emerald-900/10"}
      `}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="material-symbols-outlined text-[18px] text-emerald-400 flex-shrink-0 mt-0.5">check_circle</span>
        {!disabled && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(slotKey); }}
            className="p-0.5 text-gray-500 hover:text-rose-400 transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0 mt-1">
        <p className="text-xs text-white truncate" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{formatSize(file.size)}</p>
      </div>
      {badge && <div className="mt-2">{badge}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function NewDealClient({
  bankId,
  initialDealName,
}: {
  bankId: string;
  initialDealName: string;
}) {
  const router = useRouter();
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [bulkDragging, setBulkDragging] = useState(false);

  // Core document slot groups (hydration-safe: computeTaxYears uses getFullYear only)
  const [slotGroups] = useState<SlotGroup[]>(() => {
    const years = computeTaxYears();
    return [
      {
        label: "Business Tax Returns",
        slots: years.map((y) => ({
          key: `BUSINESS_TAX_RETURN_${y}`,
          label: `Business Tax Return \u2014 ${y}`,
        })),
      },
      {
        label: "Personal Tax Returns",
        slots: years.map((y) => ({
          key: `PERSONAL_TAX_RETURN_${y}`,
          label: `Personal Tax Return \u2014 ${y}`,
        })),
      },
      {
        label: "Financial Statements",
        slots: [
          { key: "INCOME_STATEMENT_YTD", label: "YTD Income Statement" },
          { key: "BALANCE_SHEET_CURRENT", label: "Current Balance Sheet" },
        ],
      },
      {
        label: "Personal Financial Statement",
        slots: [{ key: "PFS_CURRENT", label: "Personal Financial Statement" }],
      },
    ];
  });

  // State
  const [slotFiles, setSlotFiles] = useState<Map<string, File>>(new Map());
  const [bulkFiles, setBulkFiles] = useState<SelectedFile[]>([]);
  const [uploadOutcomes, setUploadOutcomes] = useState<Map<string, UploadOutcome>>(new Map());
  const [uploading, setUploading] = useState(false);
  const [dealName, setDealName] = useState(initialDealName || "");
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [debugInfo, setDebugInfo] = useState<{ requestId: string | null; stage: string | null }>({
    requestId: null,
    stage: null,
  });
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processErrorDetails, setProcessErrorDetails] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Inline review state machine: staging → classifying → review → submitting
  const [mode, setMode] = useState<DealMode>("staging");
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const [createdDealName, setCreatedDealName] = useState<string | null>(null);

  // Navigation guard: warn if leaving during classification or review
  useEffect(() => {
    if (mode === "staging" || mode === "submitting" || !createdDealId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [mode, createdDealId]);

  // Slot handlers
  const handleSlotFileSelect = useCallback((slotKey: string, file: File) => {
    setSlotFiles((prev) => new Map(prev).set(slotKey, file));
    // Clear any previous outcome for this slot
    setUploadOutcomes((prev) => {
      const next = new Map(prev);
      next.delete(`slot:${slotKey}`);
      return next;
    });
  }, []);

  const removeSlotFile = useCallback((slotKey: string) => {
    setSlotFiles((prev) => {
      const next = new Map(prev);
      next.delete(slotKey);
      return next;
    });
    setUploadOutcomes((prev) => {
      const next = new Map(prev);
      next.delete(`slot:${slotKey}`);
      return next;
    });
  }, []);

  // Bulk file handlers
  const handleBulkFiles = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const fileArray = Array.from(selectedFiles);
    setBulkFiles((prev) => [
      ...prev,
      ...fileArray.map((file) => ({
        id: uid(),
        file,
        checklistKey: "",
      })),
    ]);
  }, []);

  const removeBulkFile = useCallback((id: string) => {
    setBulkFiles((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleRestart = useCallback(() => {
    setSlotFiles(new Map());
    setBulkFiles([]);
    setUploadOutcomes(new Map());
    setUploading(false);
    setProcessing(false);
    setProcessError(null);
    setProcessErrorDetails(null);
    setShowErrorDetails(false);
    setNeedsRestart(false);
    setUploadProgress({ current: 0, total: 0 });
    setDebugInfo({ requestId: null, stage: null });
    setMode("staging");
    setCreatedDealId(null);
    setCreatedDealName(null);
  }, []);

  // Total file count for enabling the upload button
  const totalFiles = slotFiles.size + bulkFiles.length;

  // -------------------------------------------------------------------------
  // Upload handler
  // -------------------------------------------------------------------------
  const handleUpload = useCallback(async () => {
    if (totalFiles === 0) return;

    setUploading(true);
    setProcessing(false);
    setProcessError(null);
    setNeedsRestart(false);

    // Build unified entry list: slotted first, then bulk
    type UploadEntry = {
      outcomeKey: string;
      file: File;
      slotKey: string | null;
      checklistKey: string | null;
    };
    const entries: UploadEntry[] = [];

    for (const [slotKey, file] of slotFiles) {
      entries.push({
        outcomeKey: `slot:${slotKey}`,
        file,
        slotKey,
        checklistKey: null,
      });
    }
    for (const item of bulkFiles) {
      entries.push({
        outcomeKey: `bulk:${item.file.name}:${item.file.size}:${item.file.lastModified}`,
        file: item.file,
        slotKey: null,
        checklistKey: item.checklistKey || null,
      });
    }

    setUploadProgress({ current: 0, total: entries.length });

    // Initialize all outcomes to pending
    setUploadOutcomes(() => {
      const m = new Map<string, UploadOutcome>();
      for (const e of entries) m.set(e.outcomeKey, { status: "pending" });
      return m;
    });

    const classifyNetworkError = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      const name = (e as any)?.name;
      const isAbort = name === "AbortError";
      const isNetwork = msg === "Failed to fetch" || msg.toLowerCase().includes("networkerror");
      return { msg, name, isAbort, isNetwork };
    };

    const createBootstrap = async () => {
      const rid = requestId();
      const t = setTimeout(() => {}, 20000);
      try {
        const payload = await createUploadSession({
          dealName: dealName || `Deal - ${new Date().toLocaleDateString()}`,
          source: "banker",
          files: entries.map((e) => ({
            name: e.file.name,
            size: e.file.size,
            mime: e.file.type,
          })),
        });

        if (!payload?.ok) {
          const errText = payload?.message || payload?.error || "Failed to bootstrap deal";
          const err = new Error(errText);
          (err as any).code = payload?.code ?? null;
          throw err;
        }

        if (!payload?.dealId || !payload?.uploadUrls?.length || !payload?.sessionId) {
          throw new Error("failed_to_bootstrap_deal");
        }

        return {
          dealId: payload.dealId,
          sessionId: payload.sessionId,
          uploads: payload.uploadUrls as UploadSpec[],
          requestId: rid,
        };
      } finally {
        clearTimeout(t);
      }
    };

    const createBootstrapWithRetries = async () => {
      const maxAttempts = 3;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await createBootstrap();
        } catch (e) {
          lastErr = e;
          const { isAbort, isNetwork } = classifyNetworkError(e);
          const msg = e instanceof Error ? e.message : String(e);
          const retryableStatus =
            msg.startsWith("timeout:") || msg.includes("504") || msg.includes("502") || msg.includes("503");
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
          if (res.status === 404) continue;
          const json = await res.json().catch(() => ({}));
          if (res.status === 401) return { ok: false, error: "Unauthorized" };
          if (!res.ok || json?.ok === false) {
            if (res.status >= 500) continue;
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

    let sessionRequestId: string | null = null;

    try {
      // 1. Create deal + upload session
      setDebugInfo({ requestId: null, stage: "create_upload_session" });
      const session = await createBootstrapWithRetries();
      sessionRequestId = session.requestId ?? null;
      const dealId = session.dealId;
      const sessionId = session.sessionId;
      const createdName = dealName;

      if (!dealId) {
        throw new Error("invariant_violation: upload attempted without dealId");
      }

      console.log("[upload:start]", {
        dealId,
        sessionId,
        fileCount: entries.length,
        slotted: slotFiles.size,
        bulk: bulkFiles.length,
        requestId: session.requestId,
      });

      if (!session.uploads || session.uploads.length === 0) {
        throw new Error("upload_session_missing_uploads");
      }

      const uploadsByKey = new Map<string, UploadSpec[]>();
      for (const upload of session.uploads) {
        const key = `${upload.filename || ""}::${upload.sizeBytes}`;
        const bucket = uploadsByKey.get(key) ?? [];
        bucket.push(upload);
        uploadsByKey.set(key, bucket);
      }

      // 2. Upload files sequentially
      setUploadProgress({ current: 0, total: entries.length });
      let successCount = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const file = entry.file;
        const rid = requestId();
        setDebugInfo({ requestId: rid, stage: "starting_file" });
        setUploadProgress({ current: i + 1, total: entries.length });

        // Mark uploading
        setUploadOutcomes((prev) =>
          new Map(prev).set(entry.outcomeKey, { status: "uploading" }),
        );

        const key = `${file.name}::${file.size}`;
        const bucket = uploadsByKey.get(key) ?? [];
        const uploadSpec = bucket.shift();
        if (!uploadSpec) {
          throw new Error("upload_session_missing_uploads");
        }
        if (bucket.length === 0) uploadsByKey.delete(key);

        try {
          // PUT to signed URL
          setDebugInfo({ requestId: rid, stage: "upload_put" });
          await uploadFileWithSignedUrl({
            uploadUrl: uploadSpec.signedUrl,
            headers: uploadSpec.headers,
            file,
            context: "new-deal",
          });

          // POST to files/record
          setDebugInfo({ requestId: rid, stage: "record_file" });
          const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-request-id": rid },
            body: JSON.stringify({
              file_id: uploadSpec.fileId,
              session_id: sessionId,
              object_path: uploadSpec.objectKey,
              original_filename: file.name,
              mime_type: file.type || "application/octet-stream",
              size_bytes: file.size,
              checklist_key: entry.checklistKey || null,
              storage_bucket: uploadSpec.bucket,
              ...(entry.slotKey ? { slot_key: entry.slotKey } : {}),
            }),
          });

          if (!recordRes.ok) {
            const errJson = await recordRes.json().catch(() => null as any);
            const errText = errJson?.error || `Record failed (${recordRes.status})`;
            setUploadOutcomes((prev) =>
              new Map(prev).set(entry.outcomeKey, { status: "error", error: errText }),
            );
            throw new Error(errText);
          }

          const recordJson = await recordRes.json().catch(() => ({}));
          setUploadOutcomes((prev) =>
            new Map(prev).set(entry.outcomeKey, {
              status: "recorded",
              slotAttach: recordJson.slot_attach ?? null,
            }),
          );
          successCount++;
        } catch (fileErr) {
          // If we already set an outcome above (for record failures), skip
          // Otherwise set error outcome
          setUploadOutcomes((prev) => {
            const existing = prev.get(entry.outcomeKey);
            if (existing?.status === "error") return prev;
            return new Map(prev).set(entry.outcomeKey, {
              status: "error",
              error: fileErr instanceof Error ? fileErr.message : String(fileErr),
            });
          });
          throw fileErr; // Re-throw to stop the upload loop
        }
      }

      console.log(`Uploaded ${successCount}/${entries.length} files to deal ${dealId}`);

      // Mark upload batch as complete
      if (successCount > 0) {
        try {
          await Promise.race([
            markUploadsCompletedAction(dealId, bankId),
            new Promise<void>((_resolve, reject) =>
              setTimeout(() => reject(new Error("markUploadsCompletedAction_timeout")), 3000),
            ),
          ]);
        } catch (e) {
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

      // 4. Check if confirmation gate is active
      // If gate is OFF, redirect straight to cockpit (no inline review).
      // If gate is ON, transition to classifying mode — IntakeReviewTable
      // polls and calls onNeedsReview/onSubmitted as phase progresses.
      setDebugInfo({ requestId: null, stage: "checking_gate" });
      let gateActive = true;
      try {
        const reviewRes = await fetch(`/api/deals/${dealId}/intake/review`, { cache: "no-store" });
        const reviewJson = await reviewRes.json().catch(() => ({}));
        gateActive = Boolean(reviewJson?.ok && reviewJson?.feature_enabled);
      } catch {
        // If we can't reach the review endpoint, assume gate is active (fail closed)
      }

      if (!gateActive) {
        // Gate OFF — poll for readiness and redirect
        setDebugInfo({ requestId: null, stage: "intake_poll" });
        const pollResult = await pollIntakeStatus(dealId);
        if (!pollResult.ok) {
          throw new Error(`Intake status error: ${pollResult.error || "unknown"}`);
        }
        router.push(
          `/deals/${dealId}/cockpit${createdName ? `?n=${encodeURIComponent(createdName)}` : ""}`,
        );
      } else {
        // Gate ON — show inline review
        setCreatedDealId(dealId);
        setCreatedDealName(createdName || null);
        setMode("classifying");
      }
    } catch (error) {
      console.error("Upload failed:", error);

      const { isAbort, isNetwork, msg } = classifyNetworkError(error);
      const rawMessage = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code ?? null;
      const isSessionError =
        rawMessage.includes("upload_session") ||
        rawMessage.includes("invariant_violation") ||
        rawMessage.includes("upload_session_expired_restart");
      const isWifConfigError =
        errorCode === "WIF_AUDIENCE_INVALID" ||
        rawMessage.includes("Invalid WIF provider") ||
        rawMessage.includes("Invalid value for audience") ||
        rawMessage.includes("Missing Workload Identity");

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
      if (isWifConfigError) {
        setProcessError(
          "Upload session could not be created due to a server configuration issue. Please try again or contact support.",
        );
        setProcessErrorDetails(`Code: ${errorCode || "WIF_CONFIG"} | ${rawMessage.slice(0, 200)}`);
        return;
      }
      if (isSessionError) {
        setNeedsRestart(true);
        const tag = sessionRequestId ? ` (Request: ${sessionRequestId})` : "";
        setProcessError(`Upload session expired/invalid — restart deal creation.${tag}`);
        return;
      }
      setProcessError(msg || "Upload failed");
      setProcessErrorDetails(rawMessage !== msg ? rawMessage.slice(0, 200) : null);
    } finally {
      setUploading(false);
      setProcessing(false);
      setDebugInfo({ requestId: null, stage: null });
    }
  }, [totalFiles, slotFiles, bulkFiles, dealName, bankId, router]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isWorking = uploading || processing;

  // ── Review mode: full-screen review surface ──
  if (mode === "review" && createdDealId) {
    return (
      <div className="h-full flex flex-col bg-[#0a0d12]">
        <div className="border-b border-gray-800 px-8 py-6 bg-[#0f1318]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">Review Classifications</h1>
              <p className="text-sm text-gray-400">
                Review and confirm document classifications before processing begins.
                Documents must be confirmed before underwriting begins.
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-8">
            <IntakeReviewTable
              dealId={createdDealId}
              onNeedsReview={() => {}}
              onSubmitted={() => {
                setMode("submitting");
                router.push(
                  `/deals/${createdDealId}/cockpit${createdDealName ? `?n=${encodeURIComponent(createdDealName)}` : ""}`,
                );
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Submitting mode: redirect in progress ──
  if (mode === "submitting") {
    return (
      <div className="h-full flex flex-col bg-[#0a0d12] items-center justify-center">
        <div className="text-center space-y-3">
          <span className="animate-spin material-symbols-outlined text-[32px] text-blue-400">
            progress_activity
          </span>
          <p className="text-white text-lg font-medium">Processing started. Taking you to cockpit...</p>
        </div>
      </div>
    );
  }

  // ── Staging / Classifying mode: upload form ──
  return (
    <div className="h-full flex flex-col bg-[#0a0d12]">
      {/* Header */}
      <div className="border-b border-gray-800 px-8 py-6 bg-[#0f1318]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">New Deal Intake</h1>
            <p className="text-sm text-gray-400">
              Upload core documents to start a new deal package
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
              disabled={isWorking}
            />
          </div>

          {/* ============================================================= */}
          {/* SECTION 1: Core Documents (9 slot cards)                      */}
          {/* ============================================================= */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-blue-400 text-[20px]">folder_special</span>
              <h2 className="text-lg font-semibold text-white">Core Documents</h2>
              <span className="text-xs text-gray-500 ml-2">
                {slotFiles.size} of {slotGroups.reduce((n, g) => n + g.slots.length, 0)} attached
              </span>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              Upload each required document to its designated slot for accurate classification and processing.
            </p>

            {slotGroups.map((group) => (
              <div key={group.label} className="mb-6">
                <h3 className="text-sm font-medium text-gray-300 mb-3">{group.label}</h3>
                <div className="grid grid-cols-3 gap-3">
                  {group.slots.map((slot) => (
                    <SlotCard
                      key={slot.key}
                      slotKey={slot.key}
                      label={slot.label}
                      file={slotFiles.get(slot.key)}
                      outcome={uploadOutcomes.get(`slot:${slot.key}`)}
                      disabled={isWorking}
                      onFileSelect={handleSlotFileSelect}
                      onRemove={removeSlotFile}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ============================================================= */}
          {/* SECTION 2: Additional Documents (bulk)                        */}
          {/* ============================================================= */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-gray-400 text-[20px]">folder_open</span>
              <h2 className="text-lg font-semibold text-white">Additional Documents</h2>
              {bulkFiles.length > 0 && (
                <span className="text-xs text-gray-500 ml-2">{bulkFiles.length} file{bulkFiles.length !== 1 ? "s" : ""}</span>
              )}
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Drag & drop or browse for any other supporting documents. These will be automatically classified.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); if (!isWorking) setBulkDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setBulkDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setBulkDragging(false);
                if (!isWorking) handleBulkFiles(e.dataTransfer.files);
              }}
              className={`
                border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer
                ${bulkDragging ? "border-blue-500 bg-blue-500/10" : "border-gray-700 bg-gray-800/20 hover:border-gray-600"}
                ${isWorking ? "opacity-50 cursor-not-allowed" : ""}
              `}
              onClick={() => !isWorking && bulkInputRef.current?.click()}
            >
              <input
                ref={bulkInputRef}
                type="file"
                multiple
                onChange={(e) => { handleBulkFiles(e.target.files); e.target.value = ""; }}
                className="hidden"
                accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
                disabled={isWorking}
              />
              <div className="flex flex-col items-center text-center">
                <span className="material-symbols-outlined text-[32px] text-gray-500 mb-2">cloud_upload</span>
                <span className="text-sm text-gray-400">Drag & drop or click to browse</span>
                <span className="text-xs text-gray-600 mt-1">PDF, Excel, Word, Images</span>
              </div>
            </div>

            {/* Bulk file list */}
            {bulkFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                {bulkFiles.map((it) => {
                  const outcomeKey = `bulk:${it.file.name}:${it.file.size}:${it.file.lastModified}`;
                  const outcome = uploadOutcomes.get(outcomeKey);
                  return (
                    <div
                      key={it.id}
                      className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="material-symbols-outlined text-gray-400">description</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{it.file.name}</p>
                          <p className="text-xs text-gray-400">{formatSize(it.file.size)}</p>
                        </div>
                      </div>

                      <div className="ml-4 flex items-center gap-2">
                        <select
                          className="rounded-lg border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
                          value={it.checklistKey}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBulkFiles((prev) =>
                              prev.map((x) => (x.id === it.id ? { ...x, checklistKey: v } : x)),
                            );
                          }}
                          disabled={isWorking}
                        >
                          <option value="">Auto-classify</option>
                          {CHECKLIST_KEY_OPTIONS.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.title}</option>
                          ))}
                        </select>
                      </div>

                      {outcome?.status === "uploading" && (
                        <span className="ml-2 animate-spin material-symbols-outlined text-[16px] text-blue-400">progress_activity</span>
                      )}
                      {outcome?.status === "recorded" && (
                        <span className="ml-2 material-symbols-outlined text-[16px] text-emerald-400">check_circle</span>
                      )}
                      {outcome?.status === "error" && (
                        <span className="ml-2 material-symbols-outlined text-[16px] text-rose-400" title={outcome.error ?? undefined}>error</span>
                      )}

                      <button
                        onClick={() => removeBulkFile(it.id)}
                        className="ml-3 p-1 text-gray-400 hover:text-red-400 transition-colors"
                        disabled={isWorking}
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* Action Buttons                                                */}
          {/* ============================================================= */}
          <div className="flex justify-end gap-3 mb-6">
            {totalFiles > 0 && (
              <button
                onClick={handleRestart}
                disabled={isWorking}
                className="px-6 py-3 text-gray-400 hover:text-white transition-colors"
              >
                Clear All
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={isWorking || totalFiles === 0}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {isWorking ? (
                <>
                  {uploading
                    ? `${uploadProgress.current}/${uploadProgress.total}`
                    : "Processing"}
                  <span className="animate-spin material-symbols-outlined text-[20px]">
                    progress_activity
                  </span>
                  {uploading ? "Uploading..." : "Processing..."}
                  {debugInfo.requestId ? (
                    <span className="ml-2 text-xs text-white/80">
                      (Request: {debugInfo.requestId}
                      {debugInfo.stage ? ` \u2022 ${debugInfo.stage}` : ""})
                    </span>
                  ) : debugInfo.stage ? (
                    <span className="ml-2 text-xs text-white/80">({debugInfo.stage})</span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">upload</span>
                  Create Deal &amp; Begin Classification
                </>
              )}
            </button>
          </div>

          {/* Error Banner */}
          {processError ? (
            <div className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <div className="flex items-center justify-between gap-3">
                <span>{processError}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {needsRestart ? (
                    <button
                      onClick={handleRestart}
                      className="rounded-md border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-100 hover:border-rose-300"
                    >
                      Restart
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setProcessError(null);
                        setProcessErrorDetails(null);
                        setShowErrorDetails(false);
                      }}
                      className="rounded-md border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-100 hover:border-rose-300"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
              {processErrorDetails ? (
                <div className="mt-2">
                  <button
                    onClick={() => setShowErrorDetails((v) => !v)}
                    className="text-xs text-rose-300/70 hover:text-rose-200 underline"
                  >
                    {showErrorDetails ? "Hide details" : "Show error details"}
                  </button>
                  {showErrorDetails ? (
                    <pre className="mt-1 text-xs text-rose-300/60 bg-rose-900/20 rounded px-2 py-1 overflow-x-auto select-all">
                      {processErrorDetails}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Help Text */}
          <div className="mt-4 p-6 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <div className="flex gap-4">
              <span className="material-symbols-outlined text-blue-400 flex-shrink-0">info</span>
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">What happens next?</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>{"\u2022"} Documents will be classified by AI</li>
                  <li>{"\u2022"} You'll review and confirm each classification right here</li>
                  <li>{"\u2022"} After confirmation, processing begins automatically</li>
                  <li>{"\u2022"} You'll be redirected to the deal cockpit when ready</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Classifying: show classification progress + IntakeReviewTable below */}
          {mode === "classifying" && createdDealId && (
            <div className="mt-8">
              <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                <div className="flex items-center gap-2 text-blue-300 text-sm">
                  <span className="animate-spin material-symbols-outlined text-[16px]">
                    progress_activity
                  </span>
                  Processing uploads... Documents will appear below as classification completes.
                </div>
              </div>
              <IntakeReviewTable
                dealId={createdDealId}
                onNeedsReview={() => setMode("review")}
                onSubmitted={() => {
                  setMode("submitting");
                  router.push(
                    `/deals/${createdDealId}/cockpit${createdDealName ? `?n=${encodeURIComponent(createdDealName)}` : ""}`,
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
