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

export interface SignedUploadResponse {
  ok: boolean;
  upload?: {
    file_id: string;
    object_path: string;
    signed_url: string;
    token?: string;
    checklist_key?: string | null;
    mime_type?: string;
  };
  deal_id?: string; // For borrower portal
  error?: string;
}

export interface RecordFileResponse {
  ok: boolean;
  file_id?: string;
  error?: string;
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
 */
export async function uploadViaSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
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
): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const { dealId, file, checklistKey = null, source = "internal", packId = null } = args;

  try {
    // Step 1: Get signed URL
    const signRes = await fetch(`/api/deals/${dealId}/files/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        checklist_key: checklistKey,
        pack_id: packId,
      }),
    });

    if (!signRes.ok) {
      const err = await signRes.json();
      return { ok: false, error: err.error || "Failed to get signed URL" };
    }

    const signData: SignedUploadResponse = await signRes.json();
    if (!signData.ok || !signData.upload) {
      return { ok: false, error: signData.error || "No upload data returned" };
    }

    const { file_id, object_path, signed_url } = signData.upload;

    // Step 2: Upload directly to storage
    await uploadViaSignedUrl(signed_url, file);

    // Step 3: Record metadata
    const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    if (!recordRes.ok) {
      const err = await recordRes.json();
      return { ok: false, error: err.error || "Failed to record file" };
    }

    const recordData: RecordFileResponse = await recordRes.json();
    if (!recordData.ok) {
      return { ok: false, error: recordData.error };
    }

    return { ok: true, fileId: file_id };
  } catch (error: any) {
    console.error("[directDealDocumentUpload]", error);
    return { ok: false, error: error.message || "Upload failed" };
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
): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  try {
    // Step 1: Get signed URL (token-based auth)
    const signRes = await fetch(`/api/borrower/portal/${token}/files/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        checklist_key: checklistKey,
      }),
    });

    if (!signRes.ok) {
      const err = await signRes.json();
      return { ok: false, error: err.error || "Failed to get signed URL" };
    }

    const signData: SignedUploadResponse = await signRes.json();
    if (!signData.ok || !signData.upload || !signData.deal_id) {
      return { ok: false, error: signData.error || "No upload data returned" };
    }

    const { file_id, object_path, signed_url } = signData.upload;
    const dealId = signData.deal_id;

    // Step 2: Upload directly to storage
    await uploadViaSignedUrl(signed_url, file, onProgress);

    // Step 3: Record metadata
    const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    if (!recordRes.ok) {
      const err = await recordRes.json();
      return { ok: false, error: err.error || "Failed to record file" };
    }

    const recordData: RecordFileResponse = await recordRes.json();
    if (!recordData.ok) {
      return { ok: false, error: recordData.error };
    }

    return { ok: true, fileId: file_id };
  } catch (error: any) {
    console.error("[uploadBorrowerFile]", error);
    return { ok: false, error: error.message || "Upload failed" };
  }
}
