import { signUploadUrl } from "@/lib/uploads/sign";
import { getGcsBucketName } from "@/lib/storage/gcs";
import { createGcsV4SignedPutUrl } from "@/lib/storage/gcsSignedPutUrl";
import { hasWifProviderConfig } from "@/lib/google/wif/getWifProvider";
import type { NextRequest } from "next/server";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/tif",
  "image/gif",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

export type SignDealUploadInput = {
  req: NextRequest;
  dealId: string;
  uploadSessionId?: string | null;
  filename: string;
  mimeType?: string | null;
  sizeBytes: number;
  checklistKey?: string | null;
  requestId: string;
};

export type SignDealUploadOk = {
  ok: true;
  upload: {
    fileId: string;
    objectKey: string;
    uploadUrl: string;
    headers: Record<string, string>;
    bucket: string;
    checklistKey?: string | null;
  };
};

export type SignDealUploadErr = {
  ok: false;
  requestId: string;
  error: string;
  details?: string;
};

function randomUUID() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function safeFilename(name: string) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function signDealUpload(
  input: SignDealUploadInput,
): Promise<SignDealUploadOk | SignDealUploadErr> {
  const { req: _req, dealId, uploadSessionId, filename, mimeType, sizeBytes, checklistKey, requestId } =
    input;

  if (!filename || !sizeBytes) {
    return { ok: false, requestId, error: "missing_filename_or_size" };
  }

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, requestId, error: "file_too_large" };
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return { ok: false, requestId, error: "unsupported_file_type" };
  }

  const fileId = randomUUID();
  const safeName = safeFilename(filename);

  const sessionSegment = uploadSessionId ? `/${uploadSessionId}` : "";
  const objectKey = `deals/${dealId}${sessionSegment}/${fileId}__${safeName}`;

  const docStore = String(process.env.DOC_STORE || "").toLowerCase();
  const wantsGcs = docStore === "gcs";

  // If DOC_STORE=gcs but WIF isn't configured, either fall back (default) or fail (strict).
  const strictGcs = process.env.GCS_STRICT_SIGNING === "1";
  const wifReady = wantsGcs && hasWifProviderConfig();

  if (wantsGcs && !wifReady && strictGcs) {
    return {
      ok: false,
      requestId,
      error: "missing_gcp_config",
      details: "DOC_STORE=gcs requires WIF provider configuration (GCP_WIF_PROVIDER + related env).",
    };
  }

  // GCS signed PUT URL path (new): uses our internal WIF-enabled signer helper.
  if (wantsGcs && wifReady) {
    const gcsBucket = process.env.GCS_BUCKET || getGcsBucketName();
    const signed = await createGcsV4SignedPutUrl({
      bucket: gcsBucket,
      objectKey,
      contentType: mimeType || "application/octet-stream",
      expiresSeconds: Number(process.env.GCS_SIGN_TTL_SECONDS || "900"),
    });

    // Support common return shapes while keeping this file stable.
    const uploadUrl =
      (signed as any).url ?? (signed as any).uploadUrl ?? (signed as any).signedUrl;
    const headers =
      (signed as any).headers ?? { "Content-Type": mimeType || "application/octet-stream" };

    if (!uploadUrl) {
      return { ok: false, requestId, error: "missing_signed_url" };
    }

    return {
      ok: true,
      upload: {
        fileId,
        objectKey,
        uploadUrl,
        headers,
        bucket: gcsBucket,
        checklistKey: checklistKey ?? null,
      },
    };
  }

  // Supabase (or default) signed URL path
  const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";
  const signResult = await signUploadUrl({ bucket, objectPath: objectKey });

  if (!signResult.ok || !signResult.signedUrl) {
    if (!signResult.ok) {
      return {
        ok: false,
        requestId: signResult.requestId,
        error: signResult.error,
        details: signResult.detail,
      };
    }
    return {
      ok: false,
      requestId: signResult.requestId,
      error: "missing_signed_url",
    };
  }

  return {
    ok: true,
    upload: {
      fileId,
      objectKey,
      uploadUrl: signResult.signedUrl,
      headers: { "Content-Type": mimeType || "application/octet-stream" },
      bucket,
      checklistKey: checklistKey ?? null,
    },
  };
}
