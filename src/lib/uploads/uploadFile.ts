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

import type { UploadResult, UploadOk, UploadErr } from "./types";
import { readJson, toUploadErr, assertUploadResult, generateRequestId } from "./parse";

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
}

/**
 * Upload file via signed URL (direct to storage, no server involvement)
 * Returns UploadResult (never throws)
 */
export async function uploadViaSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();

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
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}

/**
 * Complete end-to-end upload for deal files (canonical)
 * Used by: UploadBox, deals/new, all internal banker uploads
 */
export async function directDealDocumentUpload(
  args: DirectUploadArgs,
): Promise<UploadResult> {
  const { dealId, file, checklistKey = null, source = "internal", packId = null } = args;
  const requestId = generateRequestId();

  try {
    // Step 1: Get signed URL
    const signRes = await fetch(`/api/deals/${dealId}/files/sign`, {
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
    });

    const signData = await readJson<SignedUploadResponse>(signRes);
    if (!signRes.ok || !signData?.ok || !signData.upload) {
      const errorDetail = signData?.detail ? `: ${signData.detail}` : "";
      const errorMsg = (signData?.error || `Failed to get signed URL (${signRes.status})`) + errorDetail;
      
      console.warn("[upload] sign failed", {
        requestId,
        status: signRes.status,
        error: signData?.error,
        detail: signData?.detail,
        requestId: signData?.requestId,
      });
      
      return {
        ok: false,
        error: errorMsg,
        code: signData?.details || `HTTP_${signRes.status}`,
        request_id: requestId,
      };
    }

    const { file_id, object_path, signed_url } = signData.upload;

    // Step 2: Upload directly to storage
    const uploadResult = await uploadViaSignedUrl(signed_url, file);
    if (!uploadResult.ok) {
      const err = uploadResult as UploadErr;
      console.warn("[upload] storage upload failed", { requestId, file_id, error: err.error });
      return { ...err, request_id: requestId };
    }

    // Step 3: Record metadata
    const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
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
    });

    const recordData = await readJson<UploadResult>(recordRes);
    if (!recordRes.ok || !recordData?.ok) {
      const errMsg = (recordData && !recordData.ok) ? (recordData as UploadErr).error : null;
      console.warn("[upload] record failed", { requestId, file_id, status: recordRes.status, error: errMsg });
      return {
        ok: false,
        error: errMsg || `Failed to record file (${recordRes.status})`,
        code: `HTTP_${recordRes.status}`,
        request_id: requestId,
      };
    }

    console.log("[upload] success", { requestId, file_id, filename: file.name });
    return { ok: true, file_id, checklist_key: checklistKey, request_id: requestId } as UploadResult;
  } catch (error: any) {
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
    const signRes = await fetch(`/api/borrower/portal/${token}/files/sign`, {
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
    if (!signRes.ok || !signData?.ok || !signData.upload || !signData.deal_id) {
      console.warn("[upload] borrower sign failed", { requestId, status: signRes.status });
      return {
        ok: false,
        error: signData?.error || "Failed to get signed URL",
        request_id: requestId,
      };
    }

    const { file_id, object_path, signed_url } = signData.upload;
    const dealId = signData.deal_id;

    // Step 2: Upload directly to storage
    const uploadResult = await uploadViaSignedUrl(signed_url, file, onProgress);
    if (!uploadResult.ok) {
      const err = uploadResult as UploadErr;
      console.warn("[upload] borrower storage failed", { requestId, file_id });
      return { ...err, request_id: requestId };
    }

    // Step 3: Record metadata
    const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
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
