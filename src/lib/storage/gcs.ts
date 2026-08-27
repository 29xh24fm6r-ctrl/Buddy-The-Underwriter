import "server-only";

import { Storage, type StorageOptions } from "@google-cloud/storage";
import { buildGcsObjectKey, sanitizeFilename } from "@/lib/storage/gcsNaming";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";

const DEFAULT_SIGN_TTL_SECONDS = 15 * 60;

let cachedStorage: Storage | null = null;

export function getGcsBucketName(): string {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error("GCS_BUCKET not set");
  }
  return bucket;
}

function getGcsProjectId(): string | null {
  return (
    process.env.GCS_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    null
  );
}

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export async function getGcsClient(): Promise<Storage> {
  const projectId = getGcsProjectId() ?? undefined;

  console.log("[gcs-auth] runtime", {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    has: {
      GOOGLE_APPLICATION_CREDENTIALS: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      GCP_SERVICE_ACCOUNT_EMAIL: Boolean(process.env.GCP_SERVICE_ACCOUNT_EMAIL),
      GCP_WIF_PROVIDER: Boolean(process.env.GCP_WIF_PROVIDER),
      GCP_PROJECT_NUMBER: Boolean(process.env.GCP_PROJECT_NUMBER),
      GCP_WORKLOAD_IDENTITY_POOL_ID: Boolean(process.env.GCP_WORKLOAD_IDENTITY_POOL_ID),
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: Boolean(
        process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
      ),
      GCP_PROJECT_ID: Boolean(process.env.GCP_PROJECT_ID),
      GOOGLE_CLOUD_PROJECT: Boolean(process.env.GOOGLE_CLOUD_PROJECT),
      GCS_BUCKET: Boolean(process.env.GCS_BUCKET),
      GCS_UPLOADS_ENABLED: process.env.GCS_UPLOADS_ENABLED,
    },
  });
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("[gcs-auth] branch=local-adc");
    return new Storage({ projectId });
  }

  if (isVercelRuntime()) {
    console.log("[gcs-auth] branch=vercel-wif");
    try {
      const authClient = await getVercelWifAuthClient();
      console.log("[gcs-auth] vercel-oidc-token=present", true);
      return new Storage({
        projectId,
        authClient: authClient as unknown as StorageOptions["authClient"],
      });
    } catch (e: any) {
      console.log("[gcs-auth] wif-auth-client-error", {
        name: e?.name,
        message: e?.message,
      });
      throw e;
    }
  }

  console.log("[gcs-auth] branch=missing-env");
  throw new Error(
    "Missing GCS credentials. Local: set GOOGLE_APPLICATION_CREDENTIALS. Vercel: set GCP_SERVICE_ACCOUNT_EMAIL and either GCP_WIF_PROVIDER or (GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID + GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID).",
  );
}

async function getGcsStorage(): Promise<Storage> {
  if (cachedStorage) return cachedStorage;

  cachedStorage = await getGcsClient();

  return cachedStorage;
}

export { buildGcsObjectKey, sanitizeFilename };

export async function signGcsUploadUrl(args: {
  key: string;
  contentType: string;
  expiresSeconds?: number;
  /**
   * When provided, adds an X-Goog-Content-Length-Range extension header
   * condition to the V4 signature so GCS itself rejects a PUT whose body
   * exceeds this size, instead of relying solely on the client-declared
   * size checked at sign time. The caller MUST send the identical
   * "x-goog-content-length-range: 0,<maxSizeBytes>" header on the PUT.
   */
  maxSizeBytes?: number;
}): Promise<string> {
  const storage = await getGcsStorage();
  const bucket = getGcsBucketName();
  const expires = Date.now() + (args.expiresSeconds ?? DEFAULT_SIGN_TTL_SECONDS) * 1000;

  const extensionHeaders =
    args.maxSizeBytes != null
      ? { "x-goog-content-length-range": `0,${args.maxSizeBytes}` }
      : undefined;

  const [url] = await storage
    .bucket(bucket)
    .file(args.key)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType: args.contentType,
      ...(extensionHeaders ? { extensionHeaders } : {}),
    });

  return url;
}

export async function signGcsReadUrl(args: {
  key: string;
  expiresSeconds?: number;
  /** Defaults to GCS_BUCKET; pass explicitly when the document row names its own bucket. */
  bucket?: string;
}): Promise<string> {
  const storage = await getGcsStorage();
  const bucket = args.bucket || getGcsBucketName();
  const expires = Date.now() + (args.expiresSeconds ?? DEFAULT_SIGN_TTL_SECONDS) * 1000;

  const [url] = await storage.bucket(bucket).file(args.key).getSignedUrl({
    version: "v4",
    action: "read",
    expires,
  });

  return url;
}

/**
 * Read an object's bytes back out of GCS.
 *
 * The upload path went direct-to-GCS long before the processing path learned
 * about it: OCR, the gatekeeper, extraction and segmentation all called
 * `supabase.storage.from(bucket).download(path)` with whatever bucket the
 * document row named. For a GCS-stored document that is a Supabase bucket
 * that does not exist, so every download failed and intake fell back to
 * "filename only" — see docs/UPLOAD_STORAGE_CORS.md and the
 * `ocr.skipped / reason: download_failed` ledger events of 2026-08-20..27.
 */
export async function downloadGcsObject(args: {
  bucket: string;
  key: string;
}): Promise<Buffer> {
  const storage = await getGcsStorage();
  const [contents] = await storage.bucket(args.bucket).file(args.key).download();
  return Buffer.from(contents);
}

/** Write bytes to GCS (segment PDFs, generated artifacts). */
export async function uploadGcsObject(args: {
  bucket: string;
  key: string;
  bytes: Uint8Array;
  contentType: string;
  /** false → fail if the object already exists (mirrors Supabase upsert:false). */
  overwrite?: boolean;
}): Promise<void> {
  const storage = await getGcsStorage();
  const file = storage.bucket(args.bucket).file(args.key);
  await file.save(Buffer.from(args.bytes), {
    contentType: args.contentType,
    resumable: false,
    ...(args.overwrite === false ? { preconditionOpts: { ifGenerationMatch: 0 } } : {}),
  });
}

/**
 * Verify an object actually exists in GCS. Used after a client reports a
 * direct-to-storage upload as complete, so we don't materialize a
 * deal_documents row pointing at nothing (mirrors the Supabase Storage
 * list/search check used for the Supabase-backed upload path).
 */
export async function gcsObjectExists(args: { bucket: string; key: string }): Promise<boolean> {
  const storage = await getGcsStorage();
  const [exists] = await storage.bucket(args.bucket).file(args.key).exists();
  return exists;
}


/** Delete an unreferenced object after content de-duplication. */
export async function deleteGcsObject(args: { bucket: string; key: string }): Promise<void> {
  const storage = await getGcsStorage();
  await storage.bucket(args.bucket).file(args.key).delete({ ignoreNotFound: true });
}
