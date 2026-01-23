import { signUploadUrl } from "@/lib/uploads/sign";
import { getGcsBucketName } from "@/lib/storage/gcs";
import { getVercelOidcToken } from "@/lib/google/vercelOidc";
import { exchangeOidcForFederatedAccessToken } from "@/lib/google/wifSts";
import { generateAccessToken, signBlob } from "@/lib/google/iamCredentials";
import { createV4SignedPutUrl } from "@/lib/google/gcsV4Signer";
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

export async function signDealUpload(
  input: SignDealUploadInput,
): Promise<SignDealUploadOk | SignDealUploadErr> {
  const { req, dealId, uploadSessionId, filename, mimeType, sizeBytes, checklistKey, requestId } = input;

  if (!filename || !sizeBytes) {
    return { ok: false, requestId, error: "missing_filename_or_size" };
  }

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, requestId, error: "file_too_large" };
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return { ok: false, requestId, error: "unsupported_file_type" };
  }

  const docStore = String(process.env.DOC_STORE || "").toLowerCase();
  const wantsGcs = docStore === "gcs";
  const uploadPrefix = process.env.GCS_UPLOAD_PREFIX || "deals";
  const expiresSeconds = Number(process.env.GCS_SIGN_TTL_SECONDS || "900");
  const region = process.env.GCS_SIGN_REGION || "us-central1";
  const gcsBucket = process.env.GCS_BUCKET || getGcsBucketName();
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL || "";
  const hasGcsConfig = Boolean(gcsBucket && serviceAccountEmail && process.env.GCP_WORKLOAD_IDENTITY_PROVIDER);
  const strictGcs = process.env.GCS_STRICT_SIGNING === "1";
  const docStoreEffective = wantsGcs && (!hasGcsConfig && !strictGcs) ? "supabase" : docStore;

  const fileId = randomUUID();
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");

  if (docStoreEffective === "gcs") {
    if (!hasGcsConfig) {
      return {
        ok: false,
        requestId,
        error: "missing_gcp_config",
        details: "Set GCS_BUCKET, GCP_SERVICE_ACCOUNT_EMAIL, and GCP_WORKLOAD_IDENTITY_PROVIDER.",
      };
    }

    const oidc = getVercelOidcToken(req);
    if (!oidc) {
      return {
        ok: false,
        requestId,
        error: "missing_vercel_oidc",
        details: "Enable Vercel OIDC for this route.",
      };
    }

    const sessionSegment = uploadSessionId ? `/${uploadSessionId}` : "";
    const objectKey = `${uploadPrefix}/${dealId}${sessionSegment}/${fileId}-${safeName}`;
    const federated = await exchangeOidcForFederatedAccessToken(oidc);
    const saToken = await generateAccessToken(federated);
    const signed = await createV4SignedPutUrl({
      bucket: gcsBucket,
      objectKey,
      contentType: mimeType || "application/octet-stream",
      expiresSeconds,
      region,
      serviceAccountEmail,
      signBlob: (bytes) => signBlob(saToken, bytes),
    });

    return {
      ok: true,
      upload: {
        fileId,
        objectKey: signed.objectKey,
        uploadUrl: signed.url,
        headers: signed.headers,
        bucket: gcsBucket,
        checklistKey: checklistKey ?? null,
      },
    };
  }

  const sessionSegment = uploadSessionId ? `/${uploadSessionId}` : "";
  const objectKey = `deals/${dealId}${sessionSegment}/${fileId}__${safeName}`;
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
