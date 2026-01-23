/**
 * Canonical Signed Upload Client Library
 * 
 * Bank-grade file upload with zero bytes through Next.js.
 * Works with Vercel deployment protection enabled.
 * 
 * Flow:
 * 1. Request signed URL from server
 * 2. Upload directly to Supabase Storage
 * 3. Record metadata via server
 * 4. Emit ledger event + checklist resolution
 */

import type { UploadResult, UploadErr } from "./types";
import { readJson, toUploadErr, generateRequestId } from "./parse";

export type { UploadResult, UploadOk, UploadErr } from "./types";

export interface SignedUploadResponse {
  ok: boolean;
  upload?: {
    file_id: string;
    object_path: string;
    signed_url: string;
    token?: string;
    checklist_key?: string | null;
    bucket?: string;
  };
  deal_id?: string; // For borrower portal
  error?: string;
  details?: string; // Extended error info
  request_id?: string;
}

export interface DirectUploadArgs {
  dealId: string;
  file: File;
  checklistKey?: string | null;
  source?: string;
  packId?: string | null;
  requestId?: string;
  onStage?: (stage: string, meta?: Record<string, unknown>) => void;
}

/**
 * Upload file via signed URL (direct to storage, no server involvement)
 * Returns UploadResult (never throws)
 */
export async function uploadViaSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
  headers?: Record<string, string>,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();

    // Prevent the UI from hanging forever if the storage PUT never completes.
    // 2 minutes is generous for 50MB (server-enforced) but still bounded.
    xhr.timeout = 120_000;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, file_id: "" }); // file_id filled by caller
      } else {
        resolve({
          ok: false,
          error: `Upload failed: ${xhr.status} ${xhr.statusText}`,
          code: `HTTP_${xhr.status}`,
        });
      }
    });

    xhr.addEventListener("timeout", () => {
      resolve({
        ok: false,
        error: "Upload timed out",
        code: "UPLOAD_TIMEOUT",
      });
    });

    xhr.addEventListener("error", () => {
      resolve({
        ok: false,
        error: "Network error during upload",
        code: "NETWORK_ERROR",
      });
    });

    xhr.addEventListener("abort", () => {
      resolve({
        ok: false,
        error: "Upload aborted",
        code: "UPLOAD_ABORTED",
      });
    });

    xhr.open("PUT", signedUrl);
    const contentType = file.type || "application/octet-stream";
    xhr.setRequestHeader("Content-Type", contentType);
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "content-type") continue;
        xhr.setRequestHeader(key, value);
      }
    }
    xhr.send(file);
  });
}

export async function uploadFileWithSignedUrl(args: {
  uploadUrl?: string;
  headers?: Record<string, string>;
  file: File;
  context: "new-deal" | "existing-deal";
  maxAttempts?: number;
}): Promise<UploadResult> {
  const { uploadUrl, headers, file, context } = args;
  if (!uploadUrl) {
    const err = "invariant_violation_missing_signed_url";
    if (context === "new-deal") throw new Error(err);
    return { ok: false, error: err, code: "MISSING_SIGNED_URL" };
  }

  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  let lastResult: UploadResult = { ok: false, error: "upload_failed" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await uploadViaSignedUrl(uploadUrl, file, undefined, headers);
    if (lastResult.ok) return lastResult;
    if (context === "new-deal") break;
  }

  if (context === "new-deal") {
    throw new Error("upload_session_expired_restart");
  }

  return lastResult;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function emitClientTelemetry(payload: {
  request_id: string;
  stage: string;
  message?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    if (typeof navigator !== "undefined" && typeof (navigator as any).sendBeacon === "function") {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      (navigator as any).sendBeacon("/api/debug/client-telemetry", blob);
      return;
    }

    fetch("/api/debug/client-telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": payload.request_id },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

function stage(
  requestId: string,
  onStage: DirectUploadArgs["onStage"] | undefined,
  stageName: string,
  meta?: Record<string, unknown>,
) {
  try {
    onStage?.(stageName, meta);
  } catch {
    // ignore
  }
  emitClientTelemetry({ request_id: requestId, stage: stageName, meta });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Complete end-to-end upload for deal files (canonical)
 * Used by: UploadBox, deals/new, all internal banker uploads
 */
export async function directDealDocumentUpload(
  args: DirectUploadArgs,
): Promise<UploadResult> {
  const { dealId, file, checklistKey = null, source = "internal", packId = null } = args;
  const requestId = args.requestId ?? generateRequestId();
  const onStage = args.onStage;

  try {
    stage(requestId, onStage, "upload_start", {
      dealId,
      filename: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
    });

    // Step 1: Get signed URL
    const signUrl = `/api/deals/${dealId}/files/sign`;
    let signRes: Response | null = null;
    let signData: SignedUploadResponse | null = null;

    // Retry a couple times to survive transient serverless stalls.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        stage(requestId, onStage, "sign_start", { attempt });
        signRes = await fetchWithTimeout(
          signUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-request-id": requestId,
            },
            body: JSON.stringify({
              filename: file.name,
              mime_type: file.type,
              size_bytes: file.size,
              checklist_key: checklistKey,
              pack_id: packId,
            }),
          },
          20_000,
        );
        signData = await readJson<SignedUploadResponse>(signRes);
        stage(requestId, onStage, "sign_response", {
          status: signRes.status,
          ok: signRes.ok,
          response_ok: Boolean(signData?.ok),
        });
        const dealNotFound =
          signRes.status === 404 ||
          signRes.status === 409 ||
          signData?.error === "deal_not_found" ||
          signData?.error === "deal_not_ready" ||
          String(signData?.details || "").includes("deal_not_found") ||
          String(signData?.details || "").includes("deal_not_ready");
        if (dealNotFound && attempt < 3) {
          await sleep(300 * attempt);
          continue;
        }
        break;
      } catch (e) {
        const isAbort = (e as any)?.name === "AbortError";
        const retryable = isAbort || String((e as any)?.message || e).includes("Failed to fetch");
        stage(requestId, onStage, "sign_error", {
          attempt,
          isAbort,
          message: (e as any)?.message ?? String(e),
        });
        if (!retryable || attempt === 3) throw e;
        await sleep(300 * attempt);
      }
    }

    if (!signRes || !signData || !signRes.ok || !signData?.ok || !signData.upload) {
      const signStatus = signRes?.status ?? 0;
      const errorDetail = signData?.details ? `: ${signData.details}` : "";
      const errorMsg = (signData?.error || `Failed to get signed URL (${signStatus || "no_response"})`) + errorDetail;
      
      console.warn("[upload] sign failed", {
        requestId,
        status: signStatus,
        error: signData?.error,
        details: signData?.details,
        request_id: signData?.request_id,
      });
      
      return {
        ok: false,
        error: errorMsg,
        code: signData?.details || `HTTP_${signStatus || 0}`,
        request_id: requestId,
      };
    }

    const { file_id, object_path, signed_url } = signData.upload;

    stage(requestId, onStage, "sign_ok", { file_id, object_path });

    // Step 2: Upload directly to storage
    stage(requestId, onStage, "storage_put_start", { file_id });
    const uploadResult = await uploadViaSignedUrl(signed_url, file);
    if (!uploadResult.ok) {
      const err = uploadResult as UploadErr;
      stage(requestId, onStage, "storage_put_error", {
        file_id,
        error: err.error,
        code: (err as any)?.code ?? null,
      });
      console.warn("[upload] storage upload failed", { requestId, file_id, error: err.error });
      return { ...err, request_id: requestId };
    }

    stage(requestId, onStage, "storage_put_ok", { file_id });

    // Step 3: Record metadata
    stage(requestId, onStage, "record_start", { file_id });
    const recordRes = await fetchWithTimeout(
      `/api/deals/${dealId}/files/record`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          file_id,
          object_path,
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          checklist_key: checklistKey,
          source,
          pack_id: packId,
        }),
      },
      30_000,
    );

    const recordData = await readJson<UploadResult>(recordRes);
    if (!recordRes.ok || !recordData?.ok) {
      const err = recordData && !recordData.ok ? (recordData as UploadErr) : null;
      const errorDetail = err?.details ? `: ${typeof err.details === "string" ? err.details : JSON.stringify(err.details)}` : "";
      const errMsg = err?.error ? err.error + errorDetail : null;

      stage(requestId, onStage, "record_error", {
        file_id,
        status: recordRes.status,
        ok: recordRes.ok,
        error: err?.error ?? null,
        details: err?.details ?? null,
      });

      console.warn("[upload] record failed", {
        requestId,
        file_id,
        status: recordRes.status,
        error: err?.error,
        details: err?.details,
        request_id: err?.request_id,
      });
      return {
        ok: false,
        error: errMsg || `Failed to record file (${recordRes.status})`,
        code: `HTTP_${recordRes.status}`,
        details: err?.details,
        request_id: requestId,
      };
    }

    stage(requestId, onStage, "record_ok", { file_id });

    console.log("[upload] success", { requestId, file_id, filename: file.name });

    // Best-effort: trigger OCR/doc-intel matching in the background.
    // Do not block the upload UX on OCR latency.
    try {
      const documentId = (recordData as any)?.meta?.document_id;
      if (documentId) {
        void fetch(`/api/deals/${dealId}/documents/intel/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({ documentId }),
        });
      }
    } catch {
      // ignore
    }

    return { ok: true, file_id, checklist_key: checklistKey, request_id: requestId } as UploadResult;
  } catch (error: any) {
    stage(requestId, onStage, "upload_unexpected_error", {
      message: error?.message ?? String(error),
      name: error?.name ?? null,
    });
    console.warn("[upload] unexpected error", { requestId, error: error.message });
    return toUploadErr(error, requestId);
  }
}

/**
 * Complete end-to-end upload for borrower portal
 */
export async function uploadBorrowerFile(
  token: string,
  file: File,
  checklistKey?: string | null,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const requestId = generateRequestId();

  try {
    // Step 1: Get signed URL (token-based auth)
    const signRes = await fetch(`/api/portal/${token}/files/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        checklist_key: checklistKey,
      }),
    });

    const signData = await readJson<SignedUploadResponse>(signRes);
    if (!signRes.ok || !signData?.ok || !signData.upload) {
      console.warn("[upload] borrower sign failed", { requestId, status: signRes.status });
      return {
        ok: false,
        error: signData?.error || "Failed to get signed URL",
        request_id: requestId,
      };
    }

    const { file_id, object_path, signed_url } = signData.upload;

    // Step 2: Upload directly to storage
    const uploadResult = await uploadViaSignedUrl(signed_url, file, onProgress);
    if (!uploadResult.ok) {
      const err = uploadResult as UploadErr;
      console.warn("[upload] borrower storage failed", { requestId, file_id });
      return { ...err, request_id: requestId };
    }

    // Step 3: Record metadata
    const recordRes = await fetch(`/api/portal/${token}/files/record`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        file_id,
        object_path,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        checklist_key: checklistKey,
        source: "borrower",
      }),
    });

    const recordData = await readJson<UploadResult>(recordRes);
    if (!recordRes.ok || !recordData?.ok) {
      const errMsg = (recordData && !recordData.ok) ? (recordData as UploadErr).error : null;
      console.warn("[upload] borrower record failed", { requestId, file_id });
      return {
        ok: false,
        error: errMsg || "Failed to record file",
        request_id: requestId,
      };
    }

    console.log("[upload] borrower success", { requestId, file_id });
    return { ok: true, file_id, checklist_key: checklistKey, request_id: requestId } as UploadResult;
  } catch (error: any) {
    console.warn("[upload] borrower unexpected error", { requestId, error: error.message });
    return toUploadErr(error, requestId);
  }
}
